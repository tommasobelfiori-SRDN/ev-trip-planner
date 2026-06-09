import { getVehicle } from '../lib/vehicle.js'
import { planTrip } from '../services/planner.service.js'

export default async function planRoutes(app) {
  app.post('/api/plan', async (req, reply) => {
    const b = req.body || {}
    if (!validPoint(b.origin) || !validPoint(b.dest)) {
      reply.code(400)
      return { error: 'origin e dest devono avere lat e lng numeriche' }
    }
    const vehicle = await getVehicle(b.vehicleId)
    if (!vehicle) {
      reply.code(400)
      return { error: 'vehicleId non valido' }
    }

    try {
      // Soste: array di { lat, lng, label, type:'passaggio'|'ricarica'|'riposo', durationMin }
      const rawStops = Array.isArray(b.stops) ? b.stops : Array.isArray(b.waypoints) ? b.waypoints : []
      const stops = rawStops
        .filter((p) => p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
        .map((p) => ({
          lat: Number(p.lat),
          lng: Number(p.lng),
          label: p.label,
          type: ['passaggio', 'ricarica', 'riposo'].includes(p.type) ? p.type : 'passaggio',
          durationMin: Number(p.durationMin) || 0,
          // % di carica target per le soste di ricarica (opzionale, [arrivo..100])
          targetSocPct: Number.isFinite(Number(p.targetSocPct)) ? clamp(Number(p.targetSocPct), 0, 100) : null,
        }))

      const result = await planTrip({
        origin: { lat: Number(b.origin.lat), lng: Number(b.origin.lng), label: b.origin.label },
        dest: { lat: Number(b.dest.lat), lng: Number(b.dest.lng), label: b.dest.label },
        stops,
        vehicle,
        departSocPct: clampPct(b.departSocPct, vehicle.defaultDepartSoc),
        arriveSocPct: clampPct(b.arriveSocPct, 10),
        reserveSocPct: clampPct(b.reserveSocPct, vehicle.reserveSocPct),
        tempC: clamp(numOr(b.tempC, 20), -40, 60),
        avoidTolls: !!b.avoidTolls,
        avoidHighways: !!b.avoidHighways,
        minPowerKw: Math.max(0, numOr(b.minPowerKw, 0)),
        corridorKm: Math.min(50, Math.max(0.5, numOr(b.corridorKm, 5))),
        networks: Array.isArray(b.networks) ? b.networks : [],
        poiCategories: Array.isArray(b.poiCategories) ? b.poiCategories : ['food', 'fuel', 'services'],
      })
      return result
    } catch (e) {
      app.log.error(e)
      reply.code(502)
      return { error: 'pianificazione non riuscita', detail: e.message }
    }
  })
}

function validPoint(p) {
  return p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))
}
function numOr(v, def) {
  const n = Number(v)
  return Number.isFinite(n) ? n : def
}
function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v))
}
// Percentuale SoC limitata a [0,100] (con default se input non valido).
function clampPct(v, def) {
  return clamp(numOr(v, def), 0, 100)
}
