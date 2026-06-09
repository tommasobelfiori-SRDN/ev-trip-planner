import { prisma } from '../lib/prisma.js'

export default async function tripRoutes(app) {
  app.get('/api/trips', async (req) => {
    const rows = await prisma.trip.findMany({
      where: { userId: req.userId },
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

  app.get('/api/trips/:id', async (req, reply) => {
    const t = await prisma.trip.findUnique({ where: { id: req.params.id } })
    if (!t || t.userId !== req.userId) {
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

  app.post('/api/trips', async (req, reply) => {
    const b = req.body || {}
    if (!b.origin || !b.dest || !b.vehicleId) {
      reply.code(400)
      return { error: 'origin, dest e vehicleId obbligatori' }
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
        prefs: JSON.stringify(b.prefs || {}),
        resultJson: JSON.stringify(b.result || {}),
      },
    })
    reply.code(201)
    return { id: t.id }
  })

  app.delete('/api/trips/:id', async (req, reply) => {
    const t = await prisma.trip.findUnique({ where: { id: req.params.id } })
    if (t && t.userId !== req.userId) {
      reply.code(403)
      return { error: 'non puoi eliminare un viaggio di un altro utente' }
    }
    await prisma.trip.delete({ where: { id: req.params.id } }).catch(() => {})
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
