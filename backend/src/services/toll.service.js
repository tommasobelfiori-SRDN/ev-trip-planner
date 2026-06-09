import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { env } from '../lib/env.js'
import { cached } from '../lib/cache.js'
import { resample } from '../lib/geo.js'
import { countryCodeAt } from './geocoding.service.js'

const here = dirname(fileURLToPath(import.meta.url))
const VIG = JSON.parse(readFileSync(resolve(here, '../../db/vignettes.json'), 'utf8'))
const VIG_BY_CC = Object.fromEntries((VIG.vignettes || []).map((v) => [v.code, v]))
const BARRIER_BY_CC = Object.fromEntries((VIG.barrierTollCountries || []).map((b) => [b.code, b]))

// Paesi che esentano le auto 100% elettriche dalla vignetta (BEV).
const EV_EXEMPT = new Set(['CZ'])

const MOTORWAY_SHARE = 0.88 // quota di percorrenza attribuita ad autostrade a pedaggio
const SAMPLE_KM = 75
const VIGNETTE_MIN_KM = 5 // km minimi nel Paese per considerare necessaria la vignetta

/** Distanza percorsa per Paese (km), via reverse geocoding di punti campionati. */
export async function countryDistances(points) {
  const sampled = resample(points, SAMPLE_KM)
  const out = {}
  for (let i = 0; i < sampled.length - 1; i++) {
    const a = sampled[i]
    const b = sampled[i + 1]
    const segLen = b.distKm - a.distKm
    const mid = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 }
    const cc = await countryCodeAt(mid.lat, mid.lng)
    if (!cc) continue
    out[cc] = (out[cc] || 0) + segLen
  }
  return out
}

/**
 * Stima pedaggi + obblighi vignetta del percorso.
 * @param {{avoidTolls, avoidHighways, isEv}} opts
 * @returns {Promise<{total, vignetteTotal, currency, method, disclaimer, breakdown, vignettes}>}
 */
export async function estimateToll(points, opts = {}) {
  if (opts.avoidTolls || opts.avoidHighways) {
    return {
      total: 0,
      vignetteTotal: 0,
      currency: 'EUR',
      method: opts.avoidTolls ? 'evita-pedaggi' : 'evita-autostrade',
      disclaimer:
        'Percorso impostato per evitare pedaggi/autostrade: nessun pedaggio né vignetta necessari (i tempi possono aumentare).',
      breakdown: [],
      vignettes: [],
    }
  }

  // Le distanze per Paese servono comunque (per le vignette) -> sempre calcolate.
  const dists = await countryDistances(points)
  const result = tollFromDistances(dists, { isEv: opts.isEv !== false, tripDays: opts.tripDays })

  // Pedaggi a barriera ESATTI via TollGuru, se configurato (sostituiscono solo la stima per-km).
  if (env.TOLLGURU_API_KEY) {
    try {
      const tg = await tollguruBarrier(points)
      if (tg && Number.isFinite(tg.total)) {
        result.total = round2(tg.total)
        result.method = 'tollguru'
        if (tg.breakdown?.length) result.breakdown = tg.breakdown
        result.disclaimer =
          'Pedaggi a barriera forniti da TollGuru. Vignette: prezzi ufficiali esatti (acquisto a parte).'
      }
    } catch {
      // mantieni la stima interna
    }
  }
  return result
}

/**
 * Funzione PURA (testabile): da una mappa { ISO: km } calcola pedaggi a barriera (stima) + vignette.
 */
// Giorni di copertura di un taglio di vignetta dal testo del periodo (es. "10 giorni"->10, "1 mese"->30).
function coverageDays(period) {
  const s = String(period || '').toLowerCase()
  const m = s.match(/([\d.]+)/)
  const n = m ? parseFloat(m[1]) : 1
  if (/ann|year/.test(s)) return 365
  if (/mes|month/.test(s)) return n * 30
  if (/settiman|week/.test(s)) return n * 7
  return n || 1 // giorni
}

export function tollFromDistances(dists, opts = {}) {
  const isEv = opts.isEv !== false
  const tripDays = Math.max(1, Math.ceil(opts.tripDays || 1))
  const breakdown = []
  const vignettes = []
  let total = 0
  let vignetteTotal = 0

  for (const [cc, km] of Object.entries(dists)) {
    const vig = VIG_BY_CC[cc]
    if (vig) {
      if (km < VIGNETTE_MIN_KM) continue
      const exemptEv = isEv && EV_EXEMPT.has(cc)
      // Vignetta più economica che COPRE la durata del viaggio (fallback: copertura massima).
      const covering = vig.prices.filter((p) => coverageDays(p.period) >= tripDays)
      const cheapest = covering.length
        ? covering.reduce((a, b) => (b.eur < a.eur ? b : a), covering[0])
        : vig.prices.reduce((a, b) => (coverageDays(b.period) > coverageDays(a.period) ? b : a), vig.prices[0])
      const cost = exemptEv ? 0 : cheapest.eur
      vignetteTotal += cost
      vignettes.push({
        country: cc,
        name: vig.name,
        required: true,
        exemptEv,
        km: round1(km),
        cheapest,
        prices: vig.prices,
        purchaseUrl: vig.purchaseUrl,
        note: vig.electricNote || '',
      })
      continue
    }
    const bar = BARRIER_BY_CC[cc]
    if (bar) {
      const rate = bar.approxPerKmEur ?? 0.08
      const cost = km * MOTORWAY_SHARE * rate
      total += cost
      breakdown.push({ country: cc, name: bar.name, model: 'perKm', km: round1(km), ratePerKm: rate, cost: round2(cost) })
    } else {
      breakdown.push({ country: cc, name: cc, model: 'free', km: round1(km), cost: 0 })
    }
  }

  return {
    total: round2(total),
    vignetteTotal: round2(vignetteTotal),
    currency: 'EUR',
    method: 'stima-interna',
    disclaimer:
      'Pedaggi a barriera: stima su tariffa media per km (per importi esatti configura TOLLGURU_API_KEY). ' +
      'Vignette: prezzi ufficiali esatti, da acquistare a parte.',
    breakdown,
    vignettes,
  }
}

// ---- TollGuru (pedaggi a barriera reali) ----
async function tollguruBarrier(points) {
  const key = `tollguru:${points.length}:${points[0].lat.toFixed(3)}:${points[points.length - 1].lat.toFixed(3)}`
  return cached(key, 60 * 60 * 24, async () => {
    const sampled = resample(points, 10).map((p) => [p.lat, p.lng])
    const res = await fetch('https://apis.tollguru.com/toll/v2/complete-polyline-from-mapping-service', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.TOLLGURU_API_KEY },
      body: JSON.stringify({ source: 'osrm', polyline: encodeLatLngList(sampled), vehicle: { type: '2AxlesAuto' } }),
    })
    if (!res.ok) throw new Error(`TollGuru HTTP ${res.status}`)
    const data = await res.json()
    const route0 = data?.routes?.[0]
    const cost = route0?.costs?.tag ?? route0?.costs?.cash ?? 0
    return {
      total: cost,
      breakdown: (route0?.tolls || []).map((t) => ({
        country: t.country,
        name: t.name,
        model: 'tollguru',
        cost: round2(t.tagCost ?? t.cashCost ?? 0),
      })),
    }
  })
}

function encodeLatLngList(list) {
  let lastLat = 0
  let lastLng = 0
  let out = ''
  const enc = (v) => {
    let value = v < 0 ? ~(v << 1) : v << 1
    let s = ''
    while (value >= 0x20) {
      s += String.fromCharCode((0x20 | (value & 0x1f)) + 63)
      value >>= 5
    }
    s += String.fromCharCode(value + 63)
    return s
  }
  for (const [lat, lng] of list) {
    const iLat = Math.round(lat * 1e5)
    const iLng = Math.round(lng * 1e5)
    out += enc(iLat - lastLat) + enc(iLng - lastLng)
    lastLat = iLat
    lastLng = iLng
  }
  return out
}

function round1(n) {
  return Math.round(n * 10) / 10
}
function round2(n) {
  return Math.round(n * 100) / 100
}
