import { env } from '../lib/env.js'
import { fetchJson } from '../lib/http.js'
import { cached } from '../lib/cache.js'
import { cumulativeKm, corridorBbox, nearestOnPath } from '../lib/geo.js'

const WINDOW_KM = 60 // sotto-riquadri lungo il percorso: bbox piccoli = indice spaziale veloce
const MAX_WINDOWS = 18 // tetto di sicurezza per tratte molto lunghe
const PER_REQUEST_TIMEOUT_MS = 25000

// Categorie POI -> tag OSM e tipi di elemento. (Carburanti rimossi: inutili per un'auto elettrica.)
const CATEGORIES = {
  food: { tag: 'amenity', values: ['restaurant', 'fast_food', 'cafe'], types: ['node'] },
  services: { tag: 'highway', values: ['services', 'rest_area'], types: ['node', 'way'] },
}

/**
 * POI lungo il corridoio del percorso, via Overpass (OSM). Resiliente: se una finestra
 * fallisce/scade viene saltata e si restituiscono comunque i risultati parziali.
 * @returns {{pois:Array, partial:boolean, windows:number, failed:number}}
 */
export async function poisAlongRoute(points, opts = {}) {
  const categories = opts.categories?.length ? opts.categories : ['food', 'fuel', 'services']
  const corridorKm = opts.corridorKm ?? 3
  const max = opts.max ?? 120

  const cum = cumulativeKm(points)
  const total = cum[cum.length - 1]

  // Suddividi il percorso in sotto-riquadri (con tetto: su tratte lunghe campiona riquadri distanziati).
  let segments = []
  for (let start = 0; start < total; start += WINDOW_KM) {
    const end = Math.min(total, start + WINDOW_KM)
    const seg = points.filter((_, i) => cum[i] >= start - 1 && cum[i] <= end + 1)
    if (seg.length >= 2) segments.push(seg)
  }
  if (segments.length === 0) segments.push(points)
  if (segments.length > MAX_WINDOWS) {
    const step = Math.ceil(segments.length / MAX_WINDOWS)
    segments = segments.filter((_, i) => i % step === 0)
  }
  const bboxes = segments.map((seg) => corridorBbox(seg, Math.max(corridorKm, 3)))

  // UNA sola query Overpass che unisce tutti i riquadri: un solo round-trip, un solo timeout.
  let rows
  try {
    rows = await fetchCorridor(bboxes, categories)
  } catch (e) {
    return { pois: [], partial: true, windows: bboxes.length, failed: bboxes.length, error: e.message }
  }

  const byId = new Map()
  for (const r of rows) byId.set(r.id, r)

  const pois = [...byId.values()]
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => {
      const near = nearestOnPath(points, cum, p)
      return { ...p, alongKm: near.alongKm, detourKm: near.distKm }
    })
    .filter((p) => p.detourKm <= corridorKm + 0.2)
    .sort((a, b) => a.alongKm - b.alongKm)

  return { pois, partial: false, windows: bboxes.length, failed: 0 }
}

async function fetchCorridor(bboxes, categories) {
  const blocks = []
  for (const bbox of bboxes) {
    const [south, west, north, east] = bbox
    const bb = `${south.toFixed(4)},${west.toFixed(4)},${north.toFixed(4)},${east.toFixed(4)}`
    for (const cat of categories) {
      const def = CATEGORIES[cat]
      if (!def) continue
      const regex = def.values.join('|')
      for (const elType of def.types) {
        blocks.push(`${elType}["${def.tag}"~"^(${regex})$"](${bb});`)
      }
    }
  }
  const query = `[out:json][timeout:25];(${blocks.join('')});out center 400;`
  const key = `poi:${hashStr(blocks.join('|'))}`

  return cached(key, 60 * 60 * 24 * 7, async () => {
    const data = await fetchWithRetry(query)
    return (data.elements || []).map((el) => ({
      id: `${el.type}/${el.id}`,
      name: el.tags?.name || el.tags?.brand || nameForTags(el.tags),
      category: categoryForTags(el.tags),
      lat: el.lat ?? el.center?.lat,
      lng: el.lon ?? el.center?.lon,
      tags: pickTags(el.tags),
    }))
  })
}

function hashStr(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

// Overpass può essere occupato: prova l'endpoint principale e poi un mirror, con timeout breve.
async function fetchWithRetry(query) {
  const endpoints = [env.OVERPASS_URL, 'https://overpass.kumi.systems/api/interpreter']
  let lastErr
  for (const ep of endpoints) {
    try {
      return await fetchJson(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
        timeoutMs: PER_REQUEST_TIMEOUT_MS,
      })
    } catch (e) {
      lastErr = e
    }
  }
  throw lastErr
}

function categoryForTags(tags = {}) {
  if (tags.highway === 'services' || tags.highway === 'rest_area') return 'services'
  if (tags.amenity === 'fuel') return 'fuel'
  if (['restaurant', 'fast_food', 'cafe'].includes(tags.amenity)) return 'food'
  return 'other'
}

function nameForTags(tags = {}) {
  if (tags.highway === 'services') return 'Area di servizio'
  if (tags.highway === 'rest_area') return 'Area di sosta'
  if (tags.amenity === 'fuel') return 'Stazione di rifornimento'
  if (tags.amenity === 'restaurant') return 'Ristorante'
  if (tags.amenity === 'fast_food') return 'Fast food'
  if (tags.amenity === 'cafe') return 'Bar/Caffè'
  return 'POI'
}

function pickTags(tags = {}) {
  const keep = {}
  for (const k of ['cuisine', 'brand', 'opening_hours', 'website']) if (tags[k]) keep[k] = tags[k]
  return keep
}
