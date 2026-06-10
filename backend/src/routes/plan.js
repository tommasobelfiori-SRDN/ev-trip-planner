import { getVehicle } from '../lib/vehicle.js'
import { planTrip } from '../services/planner.service.js'

// Punto geografico valido (lat/lng entro i limiti del pianeta).
const POINT = {
  type: 'object',
  required: ['lat', 'lng'],
  properties: {
    lat: { type: 'number', minimum: -90, maximum: 90 },
    lng: { type: 'number', minimum: -180, maximum: 180 },
    label: { type: 'string', maxLength: 300 },
  },
}

const PLAN_SCHEMA = {
  body: {
    type: 'object',
    required: ['origin', 'dest', 'vehicleId'],
    properties: {
      origin: POINT,
      dest: POINT,
      vehicleId: { type: 'string', minLength: 1, maxLength: 64 },
      departSocPct: { type: 'number', minimum: 0, maximum: 100 },
      arriveSocPct: { type: 'number', minimum: 0, maximum: 100 },
      reserveSocPct: { type: 'number', minimum: 0, maximum: 100 },
      tempC: { type: 'number', minimum: -40, maximum: 60 },
      avoidTolls: { type: 'boolean' },
      avoidHighways: { type: 'boolean' },
      minPowerKw: { type: 'number', minimum: 0, maximum: 1000 },
      corridorKm: { type: 'number', minimum: 0.5, maximum: 50 },
      networks: { type: 'array', maxItems: 50, items: { type: 'string', maxLength: 80 } },
      poiCategories: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 30 } },
      stops: {
        type: 'array',
        maxItems: 10, // ogni sosta è un waypoint di routing: un tetto evita richieste abnormi
        items: {
          type: 'object',
          required: ['lat', 'lng'],
          properties: {
            lat: { type: 'number', minimum: -90, maximum: 90 },
            lng: { type: 'number', minimum: -180, maximum: 180 },
            label: { type: 'string', maxLength: 300 },
            type: { type: 'string', enum: ['passaggio', 'ricarica', 'riposo'] },
            durationMin: { type: 'number', minimum: 0, maximum: 1440 },
            targetSocPct: { type: ['number', 'null'], minimum: 0, maximum: 100 },
          },
        },
      },
    },
  },
}

// Controllo sul body GREZZO, prima della coercizione AJV: null/stringhe su lat/lng
// verrebbero coerciti a numeri (null -> 0!) invece di essere respinti.
function rawPointOk(p) {
  return p && typeof p === 'object' && typeof p.lat === 'number' && Number.isFinite(p.lat) && typeof p.lng === 'number' && Number.isFinite(p.lng)
}
async function preValidatePoints(req, reply) {
  const b = req.body
  if (!b || typeof b !== 'object') return // ci pensa lo schema
  const bad =
    (b.origin !== undefined && !rawPointOk(b.origin)) ||
    (b.dest !== undefined && !rawPointOk(b.dest)) ||
    (Array.isArray(b.stops) && b.stops.some((s) => !rawPointOk(s)))
  if (bad) {
    reply.code(400).send({ error: 'Richiesta non valida', detail: 'lat e lng devono essere numeri finiti' })
  }
}

export default async function planRoutes(app) {
  app.post('/api/plan', { schema: PLAN_SCHEMA, preValidation: preValidatePoints }, async (req, reply) => {
    const b = req.body
    const vehicle = await getVehicle(b.vehicleId)
    if (!vehicle) {
      reply.code(400)
      return { error: 'vehicleId non valido' }
    }

    try {
      // Soste: array di { lat, lng, label, type:'passaggio'|'ricarica'|'riposo', durationMin }
      const stops = (b.stops || [])
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
