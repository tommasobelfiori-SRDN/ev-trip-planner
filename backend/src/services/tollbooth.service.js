import { cached } from '../lib/cache.js'
import { cumulativeKm, corridorBbox, nearestOnPath } from '../lib/geo.js'
import { overpassFetch, hashStr } from './charging.service.js'

// Barriere e caselli di pedaggio lungo il percorso (OpenStreetMap):
// barrier=toll_booth (caselli fisici) e highway=toll_gantry (portali free-flow).
// Servono come RIFERIMENTO per l'utente ("Barriera di Rondissone"), non per il calcolo del costo.

const WINDOW_KM = 250
const MAX_WINDOWS = 8
const NEAR_KM = 1.2 // i caselli stanno sulla carreggiata: oltre ~1 km è un'altra strada

/**
 * Trova caselli/barriere di pedaggio con nome lungo il percorso, ordinati per km.
 * @returns {Promise<Array<{name, lat, lng, alongKm, type:'casello'|'portale'}>>}
 */
export async function tollBoothsAlongRoute(points) {
  if (!points || points.length < 2) return []
  const cum = cumulativeKm(points)
  const total = cum[cum.length - 1]

  let segments = []
  for (let start = 0; start < total; start += WINDOW_KM) {
    const end = Math.min(total, start + WINDOW_KM)
    const seg = points.filter((_, i) => cum[i] >= start - 2 && cum[i] <= end + 2)
    if (seg.length >= 2) segments.push(seg)
  }
  if (segments.length === 0) segments.push(points)
  // Sulle tratte lunghissime RAGGRUPPA le finestre (mai scartarle: si perderebbero barriere).
  if (segments.length > MAX_WINDOWS) {
    const groupSize = Math.ceil(segments.length / MAX_WINDOWS)
    const grouped = []
    for (let i = 0; i < segments.length; i += groupSize) grouped.push(segments.slice(i, i + groupSize).flat())
    segments = grouped
  }

  const blocks = []
  for (const seg of segments) {
    const [s, w, n, e] = corridorBbox(seg, 2)
    const bb = `${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`
    blocks.push(`node["barrier"="toll_booth"](${bb});`)
    blocks.push(`way["barrier"="toll_booth"](${bb});`)
    blocks.push(`node["highway"="toll_gantry"](${bb});`)
  }
  // cap alto: una singola barriera può avere 20+ nodi (uno per corsia)
  const query = `[out:json][timeout:40];(${blocks.join('')});out center tags 6000;`
  const key = `tollbooth:${hashStr(blocks.join('|'))}`
  const elements = await cached(key, 60 * 60 * 24 * 14, async () => {
    const data = await overpassFetch(query)
    return (data.elements || []).map((el) => ({
      name: el.tags?.name || el.tags?.['name:it'] || null,
      lat: el.lat ?? el.center?.lat,
      lng: el.lon ?? el.center?.lon,
      gantry: el.tags?.highway === 'toll_gantry',
    }))
  })

  const raw = elements
    .filter((b) => b.name && Number.isFinite(b.lat) && Number.isFinite(b.lng))
    .map((b) => {
      const near = nearestOnPath(points, cum, b)
      return { ...b, alongKm: near.alongKm, distKm: near.distKm }
    })
    .filter((b) => b.distKm <= NEAR_KM)

  return dedupeBooths(raw)
}

/**
 * Dedup: i caselli hanno spesso un nodo per corsia (stesso nome, a volte con varianti di
 * trattini/accenti) e impianti sovrapposti a pochi metri. Tieni il primo per
 * (nome normalizzato, ~3 km) e scarta qualunque altro impianto entro 400 m.
 */
export function dedupeBooths(list) {
  const sorted = [...list].sort((a, b) => a.alongKm - b.alongKm)
  const out = []
  for (const b of sorted) {
    const norm = normName(b.name)
    const dupName = out.find((o) => o.norm === norm && Math.abs(o.alongKm - b.alongKm) < 3)
    const dupNear = out.find((o) => Math.abs(o.alongKm - b.alongKm) < 0.4)
    if (dupName || dupNear) continue
    out.push({ norm, name: String(b.name).trim(), lat: b.lat, lng: b.lng, alongKm: Math.round(b.alongKm * 10) / 10, type: b.gantry ? 'portale' : 'casello' })
  }
  return out.map(({ norm, ...rest }) => rest)
}

// "Saint-Michel-Echangeur" e "Saint Michel Echangeur" sono lo stesso impianto.
function normName(s) {
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // accenti
    .replace(/[^a-z0-9]/g, '') // spazi, trattini, punteggiatura
}
