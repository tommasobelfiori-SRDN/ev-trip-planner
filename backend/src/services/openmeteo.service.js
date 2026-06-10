import { fetchJson } from '../lib/http.js'
import { cached } from '../lib/cache.js'
import { cumulativeKm, resample } from '../lib/geo.js'

// Open-Meteo: API gratuite senza chiave (https://open-meteo.com). Due usi:
// 1) ELEVAZIONE lungo il percorso -> consumo realistico su salite/discese (OSRM non la fornisce)
// 2) TEMPERATURA prevista lungo il percorso -> fattore consumo automatico (freddo/caldo)

const ELEVATION_URL = 'https://api.open-meteo.com/v1/elevation'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const MAX_ELE_SAMPLES = 100 // una sola chiamata batch

/**
 * Arricchisce i punti del percorso con l'elevazione (proprietà `ele`, metri), mutandoli.
 * Campiona ≤100 punti, una chiamata batch, poi interpola sull'intero percorso.
 * @returns {boolean} true se l'elevazione è stata applicata
 */
export async function addElevation(points) {
  if (!points || points.length < 2) return false
  const cum = cumulativeKm(points)
  const total = cum[cum.length - 1]
  if (total < 5) return false // percorso troppo corto: irrilevante

  const step = Math.max(3, total / (MAX_ELE_SAMPLES - 1))
  const sampled = resample(points, step).slice(0, MAX_ELE_SAMPLES)

  const key = `ele:${sampled[0].lat.toFixed(3)},${sampled[0].lng.toFixed(3)}:${sampled.length}:${total.toFixed(0)}`
  const elevations = await cached(key, 60 * 60 * 24 * 30, async () => {
    const lats = sampled.map((p) => p.lat.toFixed(4)).join(',')
    const lngs = sampled.map((p) => p.lng.toFixed(4)).join(',')
    const data = await fetchJson(`${ELEVATION_URL}?latitude=${lats}&longitude=${lngs}`, { timeoutMs: 8000 })
    return Array.isArray(data.elevation) ? data.elevation : null
  })
  if (!elevations || elevations.length !== sampled.length) return false

  // Interpola l'elevazione campionata su TUTTI i punti del percorso (per distanza progressiva).
  let j = 0
  for (let i = 0; i < points.length; i++) {
    const d = cum[i]
    while (j < sampled.length - 2 && sampled[j + 1].distKm <= d) j++
    const a = sampled[j]
    const b = sampled[Math.min(j + 1, sampled.length - 1)]
    const span = (b.distKm ?? total) - (a.distKm ?? 0) || 1
    const t = Math.min(1, Math.max(0, (d - (a.distKm ?? 0)) / span))
    points[i].ele = elevations[j] + t * (elevations[Math.min(j + 1, elevations.length - 1)] - elevations[j])
  }
  return true
}

/**
 * Temperatura media prevista lungo il percorso all'orario di partenza (3 punti: inizio/metà/fine).
 * @param {Array<{lat,lng}>} points
 * @param {string} [departureTime] ISO (es. "2026-06-11T08:00"); default: adesso
 * @returns {Promise<{tempC:number, samples:number[]}|null>}
 */
export async function routeTemperature(points, departureTime) {
  if (!points || points.length < 2) return null
  const picks = [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]]
  const lats = picks.map((p) => p.lat.toFixed(2)).join(',')
  const lngs = picks.map((p) => p.lng.toFixed(2)).join(',')

  // Ora target: arrotonda all'ora; le previsioni orarie coprono 2 giorni.
  const when = departureTime ? new Date(departureTime) : new Date()
  if (Number.isNaN(when.getTime())) return null
  const hourIso = when.toISOString().slice(0, 13) // "YYYY-MM-DDTHH"

  const key = `meteo:${lats}:${lngs}:${hourIso}`
  return cached(key, 60 * 60, async () => {
    const url = `${FORECAST_URL}?latitude=${lats}&longitude=${lngs}&hourly=temperature_2m&forecast_days=2&timezone=UTC`
    const data = await fetchJson(url, { timeoutMs: 8000 })
    const list = Array.isArray(data) ? data : [data] // 1 località = oggetto, N = array
    const temps = []
    for (const loc of list) {
      const times = loc?.hourly?.time || []
      const values = loc?.hourly?.temperature_2m || []
      let idx = times.findIndex((t) => t.startsWith(hourIso))
      if (idx === -1) idx = 0 // partenza oltre le previsioni: usa la prima ora disponibile
      if (Number.isFinite(values[idx])) temps.push(values[idx])
    }
    if (!temps.length) return null
    const tempC = Math.round((temps.reduce((s, t) => s + t, 0) / temps.length) * 10) / 10
    return { tempC, samples: temps }
  })
}
