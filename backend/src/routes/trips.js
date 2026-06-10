import { randomBytes } from 'node:crypto'
import { prisma } from '../lib/prisma.js'

// Identificativo del browser OSPITE: separa i viaggi degli anonimi (prima erano tutti condivisi).
const ANON_COOKIE = 'ev_anon'
const ANON_COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 365 * 24 * 60 * 60 }

// Filtro di proprietà: utente loggato -> per userId; ospite -> per anonId (mai null/null).
function ownerWhere(req) {
  if (req.userId) return { userId: req.userId }
  const anon = req.cookies?.[ANON_COOKIE]
  return { userId: null, anonId: anon || '__nessuno__' }
}

function ownsTrip(req, t) {
  if (!t) return false
  if (req.userId) return t.userId === req.userId
  const anon = req.cookies?.[ANON_COOKIE]
  return !!anon && t.userId === null && t.anonId === anon
}

const POINT = {
  type: 'object',
  required: ['lat', 'lng'],
  properties: {
    lat: { type: 'number', minimum: -90, maximum: 90 },
    lng: { type: 'number', minimum: -180, maximum: 180 },
    label: { type: 'string', maxLength: 300 },
  },
}

const SAVE_SCHEMA = {
  body: {
    type: 'object',
    required: ['origin', 'dest', 'vehicleId'],
    properties: {
      origin: POINT,
      dest: POINT,
      vehicleId: { type: 'string', minLength: 1, maxLength: 64 },
      prefs: { type: 'object' },
      result: { type: 'object' },
    },
  },
}

const ID_SCHEMA = { params: { type: 'object', properties: { id: { type: 'string', maxLength: 64 } } } }

export default async function tripRoutes(app) {
  app.get('/api/trips', async (req) => {
    const rows = await prisma.trip.findMany({
      where: ownerWhere(req),
      orderBy: { createdAt: 'desc' },
      include: { vehicle: { select: { name: true } } },
      take: 50,
    })
    return {
      trips: rows.map((t) => ({
        id: t.id,
        originLabel: t.originLabel,
        destLabel: t.destLabel,
        vehicle: t.vehicle?.name,
        createdAt: t.createdAt,
      })),
    }
  })

  app.get('/api/trips/:id', { schema: ID_SCHEMA }, async (req, reply) => {
    const t = await prisma.trip.findUnique({ where: { id: req.params.id } })
    if (!ownsTrip(req, t)) {
      reply.code(404)
      return { error: 'viaggio non trovato' }
    }
    return {
      trip: {
        ...t,
        prefs: safeParse(t.prefs),
        result: safeParse(t.resultJson),
      },
    }
  })

  // bodyLimit dedicato: il risultato salvato include le geometrie complete (tratte lunghe > 1 MB)
  app.post('/api/trips', { schema: SAVE_SCHEMA, bodyLimit: 5 * 1024 * 1024 }, async (req, reply) => {
    const b = req.body

    // Ospite: assegna (o riusa) l'identificativo anonimo del browser via cookie.
    let anonId = null
    if (!req.userId) {
      anonId = req.cookies?.[ANON_COOKIE] || randomBytes(16).toString('hex')
      reply.setCookie(ANON_COOKIE, anonId, ANON_COOKIE_OPTS)
    }

    const t = await prisma.trip.create({
      data: {
        originLabel: b.origin.label || `${b.origin.lat},${b.origin.lng}`,
        originLat: Number(b.origin.lat),
        originLng: Number(b.origin.lng),
        destLabel: b.dest.label || `${b.dest.lat},${b.dest.lng}`,
        destLat: Number(b.dest.lat),
        destLng: Number(b.dest.lng),
        vehicleId: b.vehicleId,
        userId: req.userId,
        anonId,
        prefs: JSON.stringify(b.prefs || {}),
        resultJson: JSON.stringify(b.result || {}),
      },
    })
    reply.code(201)
    return { id: t.id }
  })

  app.delete('/api/trips/:id', { schema: ID_SCHEMA }, async (req, reply) => {
    const t = await prisma.trip.findUnique({ where: { id: req.params.id } })
    if (!t) {
      reply.code(404)
      return { error: 'viaggio non trovato' }
    }
    if (!ownsTrip(req, t)) {
      reply.code(403)
      return { error: 'non puoi eliminare un viaggio che non è tuo' }
    }
    await prisma.trip.delete({ where: { id: req.params.id } })
    return { ok: true }
  })
}

function safeParse(s) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
