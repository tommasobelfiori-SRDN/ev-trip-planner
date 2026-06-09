import { env } from '../lib/env.js'
import { fetchJson } from '../lib/http.js'
import { cached } from '../lib/cache.js'
import { pathLengthKm } from '../lib/geo.js'

const hasORS = () => env.ORS_API_KEY && env.ORS_API_KEY.length > 10

/**
 * Calcola un percorso stradale attraverso una sequenza di punti (partenza, tappe…, arrivo).
 * Usa OpenRouteService se è configurata una chiave (supporta evita pedaggi/autostrade ed elevazione),
 * altrimenti il server pubblico OSRM (senza quei filtri).
 *
 * @param {Array<{lat,lng}>} waypoints almeno 2 punti
 * @returns {Promise<{provider, points:Array<{lat,lng,ele?}>, distanceKm, durationS, hasElevation, warnings:string[]}>}
 */
export async function route(waypoints, opts = {}) {
  const pts = Array.isArray(waypoints) ? waypoints : [waypoints, opts.dest] // retrocompatibilità
  if (!pts || pts.length < 2) throw new Error('Servono almeno partenza e arrivo')
  const avoidTolls = !!opts.avoidTolls
  const avoidHighways = !!opts.avoidHighways
  const key = `route:${hasORS() ? 'ors' : 'osrm'}:${pts.map(round).join('|')}:t${avoidTolls ? 1 : 0}:h${avoidHighways ? 1 : 0}`
  return cached(key, 60 * 60 * 24 * 7, async () => {
    if (hasORS()) return routeORS(pts, { avoidTolls, avoidHighways })
    return routeOSRM(pts, { avoidTolls, avoidHighways })
  })
}

function round(p) {
  return `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`
}

async function routeORS(waypoints, { avoidTolls, avoidHighways }) {
  const avoid = []
  if (avoidTolls) avoid.push('tollways')
  if (avoidHighways) avoid.push('highways')
  const body = {
    coordinates: waypoints.map((p) => [p.lng, p.lat]),
    elevation: true,
    instructions: false,
  }
  if (avoid.length) body.options = { avoid_features: avoid }

  const data = await fetchJson(`${env.ORS_URL}/v2/directions/driving-car/geojson`, {
    method: 'POST',
    headers: {
      Authorization: env.ORS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const feat = data.features?.[0]
  if (!feat) throw new Error('ORS: nessun percorso trovato')
  const coords = feat.geometry.coordinates // [lng, lat, ele]
  const points = coords.map((c) => ({ lat: c[1], lng: c[0], ele: c[2] }))
  const sum = feat.properties.summary
  return {
    provider: 'openrouteservice',
    points,
    distanceKm: (sum.distance ?? pathLengthKm(points) * 1000) / 1000,
    durationS: sum.duration ?? 0,
    hasElevation: true,
    warnings: [],
  }
}

async function routeOSRM(waypoints, { avoidTolls, avoidHighways }) {
  const coordStr = waypoints.map((p) => `${p.lng},${p.lat}`).join(';')
  const url = `${env.OSRM_URL}/route/v1/driving/${coordStr}?overview=full&geometries=geojson`
  const data = await fetchJson(url)
  const r = data.routes?.[0]
  if (!r) throw new Error('OSRM: nessun percorso trovato')
  const points = r.geometry.coordinates.map((c) => ({ lat: c[1], lng: c[0] }))
  const warnings = []
  if (avoidTolls || avoidHighways) {
    warnings.push(
      'Le opzioni "evita pedaggi/autostrade" richiedono una chiave OpenRouteService (ORS_API_KEY): ignorate con OSRM.'
    )
  }
  return {
    provider: 'osrm',
    points,
    distanceKm: r.distance / 1000,
    durationS: r.duration,
    hasElevation: false,
    warnings,
  }
}
