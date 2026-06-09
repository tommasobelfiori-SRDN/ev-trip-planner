import { prisma } from '../lib/prisma.js'
import { listVehicles, parseVehicle } from '../lib/vehicle.js'

export default async function vehicleRoutes(app) {
  app.get('/api/vehicles', async (req) => {
    return { vehicles: await listVehicles(req.userId) }
  })

  app.post('/api/vehicles', async (req, reply) => {
    const b = req.body || {}
    const required = ['name', 'batteryKwh', 'consumptionWhKm', 'maxChargeKw']
    for (const f of required) {
      if (b[f] === undefined || b[f] === null || b[f] === '') {
        reply.code(400)
        return { error: `Campo obbligatorio mancante: ${f}` }
      }
    }
    const batteryKwh = Number(b.batteryKwh)
    const usableKwh = Number(b.usableKwh || b.batteryKwh)
    const connectors = Array.isArray(b.connectors) && b.connectors.length ? b.connectors : ['CCS', 'Type2']
    const chargeCurve =
      Array.isArray(b.chargeCurve) && b.chargeCurve.length
        ? sanitizeCurve(b.chargeCurve) || defaultCurve(Number(b.maxChargeKw))
        : defaultCurve(Number(b.maxChargeKw))

    const row = await prisma.vehicle.create({
      data: {
        name: String(b.name),
        batteryKwh,
        usableKwh,
        consumptionWhKm: Number(b.consumptionWhKm),
        maxChargeKw: Number(b.maxChargeKw),
        chargeCurve: JSON.stringify(chargeCurve),
        connectors: JSON.stringify(connectors),
        reserveSocPct: b.reserveSocPct != null ? Number(b.reserveSocPct) : 10,
        defaultDepartSoc: b.defaultDepartSoc != null ? Number(b.defaultDepartSoc) : 90,
        isCustom: true,
        userId: req.userId,
      },
    })
    reply.code(201)
    return { vehicle: parseVehicle(row) }
  })

  app.put('/api/vehicles/:id', async (req, reply) => {
    const row = await prisma.vehicle.findUnique({ where: { id: req.params.id } })
    if (!row) {
      reply.code(404)
      return { error: 'veicolo non trovato' }
    }
    if (!row.isCustom) {
      reply.code(403)
      return { error: 'i veicoli pre-caricati non si possono modificare (duplicane uno custom)' }
    }
    if (row.userId !== req.userId) {
      reply.code(403)
      return { error: 'non puoi modificare un veicolo di un altro utente' }
    }
    const b = req.body || {}
    const curve = Array.isArray(b.chargeCurve) && b.chargeCurve.length ? sanitizeCurve(b.chargeCurve) : undefined
    if (b.chargeCurve && !curve) {
      reply.code(400)
      return { error: 'curva di ricarica non valida: servono almeno 2 punti {socPct, kw}' }
    }
    const updated = await prisma.vehicle.update({
      where: { id: req.params.id },
      data: {
        name: b.name != null ? String(b.name) : undefined,
        batteryKwh: b.batteryKwh != null ? Number(b.batteryKwh) : undefined,
        usableKwh: b.usableKwh != null ? Number(b.usableKwh) : undefined,
        consumptionWhKm: b.consumptionWhKm != null ? Number(b.consumptionWhKm) : undefined,
        maxChargeKw: b.maxChargeKw != null ? Number(b.maxChargeKw) : undefined,
        reserveSocPct: b.reserveSocPct != null ? Number(b.reserveSocPct) : undefined,
        defaultDepartSoc: b.defaultDepartSoc != null ? Number(b.defaultDepartSoc) : undefined,
        connectors: Array.isArray(b.connectors) ? JSON.stringify(b.connectors) : undefined,
        chargeCurve: curve ? JSON.stringify(curve) : undefined,
      },
    })
    return { vehicle: parseVehicle(updated) }
  })

  app.delete('/api/vehicles/:id', async (req, reply) => {
    const row = await prisma.vehicle.findUnique({ where: { id: req.params.id } })
    if (!row) {
      reply.code(404)
      return { error: 'veicolo non trovato' }
    }
    if (!row.isCustom) {
      reply.code(403)
      return { error: 'i veicoli pre-caricati non si possono eliminare' }
    }
    if (row.userId !== req.userId) {
      reply.code(403)
      return { error: 'non puoi eliminare un veicolo di un altro utente' }
    }
    await prisma.vehicle.delete({ where: { id: req.params.id } })
    return { ok: true }
  })
}

// Valida/normalizza una curva di ricarica: punti {socPct 0-100, kw>0}, ordinati per SoC, min 2 punti.
function sanitizeCurve(curve) {
  const pts = (curve || [])
    .map((p) => ({ socPct: Number(p.socPct), kw: Number(p.kw) }))
    .filter((p) => Number.isFinite(p.socPct) && Number.isFinite(p.kw) && p.socPct >= 0 && p.socPct <= 100 && p.kw > 0)
    .sort((a, b) => a.socPct - b.socPct)
  // rimuovi SoC duplicate (tieni la prima)
  const seen = new Set()
  const out = pts.filter((p) => (seen.has(p.socPct) ? false : seen.add(p.socPct)))
  return out.length >= 2 ? out : null
}

// Curva di ricarica di default realistica in funzione della potenza di picco
// (picco a ~15% SoC, breve plateau, poi taper progressivo verso il 100%).
function defaultCurve(maxKw) {
  const k = (f) => Math.round(maxKw * f)
  return [
    { socPct: 5, kw: k(0.88) },
    { socPct: 15, kw: k(1.0) },
    { socPct: 30, kw: k(0.9) },
    { socPct: 45, kw: k(0.72) },
    { socPct: 60, kw: k(0.55) },
    { socPct: 75, kw: k(0.4) },
    { socPct: 85, kw: k(0.28) },
    { socPct: 100, kw: k(0.1) },
  ]
}
