import pLimit from 'p-limit'
import { env } from './env.js'

// Limitatori di concorrenza per host, per rispettare le policy d'uso.
// Nominatim: 1 req/s. Overpass: ~2 connessioni per IP (le query a finestre girano in coppia;
// serializzarle a 1 con pausa fa scadere i timeout per-zona mentre sono ancora in coda).
const HOST_CONCURRENCY = {
  'overpass-api.de': 2,
  'overpass.kumi.systems': 2,
  'overpass.private.coffee': 2,
}
const limiters = new Map()
function limiterFor(host) {
  if (!limiters.has(host)) limiters.set(host, pLimit(HOST_CONCURRENCY[host] || 1))
  return limiters.get(host)
}

// Ritardo minimo tra richieste allo stesso host (ms). Nominatim è il più sensibile;
// per Overpass un piccolo distanziamento evita le raffiche che fanno scattare il
// blocco per IP (le colonnine usano comunque 1 sola richiesta per viaggio).
const MIN_GAP_MS = {
  'nominatim.openstreetmap.org': 1100,
  'overpass-api.de': 400,
  'overpass.private.coffee': 400,
  'overpass.kumi.systems': 400,
}
const lastCall = new Map()

async function spacedDelay(host) {
  const gap = MIN_GAP_MS[host]
  if (!gap) return
  const prev = lastCall.get(host) || 0
  const wait = prev + gap - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCall.set(host, Date.now())
}

/**
 * fetch JSON con: User-Agent OSM-compliant, rate-limit per host, timeout e gestione errori.
 */
export async function fetchJson(url, options = {}) {
  const u = new URL(url)
  const host = u.host
  return limiterFor(host)(async () => {
    await spacedDelay(host)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 20000)
    try {
      const res = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'User-Agent': env.USER_AGENT,
          Accept: 'application/json',
          ...(options.headers || {}),
        },
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        const err = new Error(`HTTP ${res.status} su ${host}: ${body.slice(0, 200)}`)
        err.status = res.status
        throw err
      }
      return await res.json()
    } finally {
      clearTimeout(timeout)
    }
  })
}

export async function fetchText(url, options = {}) {
  const u = new URL(url)
  const host = u.host
  return limiterFor(host)(async () => {
    await spacedDelay(host)
    const res = await fetch(url, {
      ...options,
      headers: { 'User-Agent': env.USER_AGENT, ...(options.headers || {}) },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} su ${host}`)
    return await res.text()
  })
}
