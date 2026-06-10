import { env } from '../lib/env.js'
import { fetchJson } from '../lib/http.js'
import { cached } from '../lib/cache.js'

/**
 * Geocoding indirizzo -> coordinate, via Nominatim (OSM). Risultati in cache 30 giorni.
 * @param {string} query
 * @returns {Promise<Array<{label:string, lat:number, lng:number, type:string}>>}
 */
export async function geocode(query) {
  const q = (query || '').trim()
  if (q.length < 2) return []
  const key = `geocode:${q.toLowerCase()}`
  return cached(key, 60 * 60 * 24 * 30, async () => {
    const url = new URL('/search', env.NOMINATIM_URL)
    url.searchParams.set('q', q)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('addressdetails', '0')
    url.searchParams.set('limit', '6')
    // Bias sull'Europa per coerenza con la copertura dell'app.
    url.searchParams.set('accept-language', 'it')
    const rows = await fetchJson(url.toString())
    return rows.map((r) => ({
      // troncata a 300: gli schemi di /api/plan e /api/trips accettano label fino a 300 caratteri
      label: String(r.display_name || '').slice(0, 300),
      lat: Number(r.lat),
      lng: Number(r.lon),
      type: r.type,
    }))
  })
}

/**
 * Reverse geocoding minimale -> codice Paese ISO (es. "IT"). Usato per stima pedaggi.
 * Coordinate arrotondate per massimizzare i cache-hit. Cache 90 giorni.
 */
export async function countryCodeAt(lat, lng) {
  const rLat = Math.round(lat * 10) / 10
  const rLng = Math.round(lng * 10) / 10
  const key = `cc:${rLat},${rLng}`
  return cached(key, 60 * 60 * 24 * 90, async () => {
    const url = new URL('/reverse', env.NOMINATIM_URL)
    url.searchParams.set('lat', String(rLat))
    url.searchParams.set('lon', String(rLng))
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('zoom', '5')
    try {
      const r = await fetchJson(url.toString())
      const cc = r?.address?.country_code
      return cc ? cc.toUpperCase() : null
    } catch {
      return null
    }
  })
}
