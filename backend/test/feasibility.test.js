import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planCharging } from '../src/services/planner.service.js'

// Scenario sintetico: percorso 400 km, consumo 200 Wh/km, batteria utile 50 kWh.
// Colonnine a km 5 e km 200. Per arrivare dalla sosta@200 serve caricare al 90% (45 kWh):
// oltre il cap dell'80% della modalità "fastest". Deve comunque risultare PERCORRIBILE.
function makeCtx() {
  const profile = []
  for (let d = 0; d <= 400; d += 10) {
    profile.push({ alongKm: d, socPct: 90 - ((d * 0.2) / 50) * 100, kWhFromStart: d * 0.2 })
  }
  const stations = [
    { id: 'a', name: 'A', operator: 'X', lat: 0, lng: 0, maxPowerKw: 150, alongKm: 5, detourKm: 0 },
    { id: 'b', name: 'B', operator: 'X', lat: 0, lng: 0, maxPowerKw: 150, alongKm: 200, detourKm: 0 },
  ]
  return { consumption: { profile, totalKwh: 80, avgWhKm: 200 }, stations, toll: {} }
}

const vehicle = {
  usableKwh: 50,
  consumptionWhKm: 200,
  reserveSocPct: 10,
  defaultDepartSoc: 90,
  connectors: ['CCS'],
  chargeCurve: [
    { socPct: 10, kw: 150 },
    { socPct: 80, kw: 60 },
    { socPct: 100, kw: 20 },
  ],
}
const params = { departSocPct: 90, arriveSocPct: 10, reserveSocPct: 10 }

test('fastest (cap 80%) resta percorribile anche se un tratto richiede oltre l’80% di carica', () => {
  const res = planCharging({ points: [] }, makeCtx(), vehicle, params, 80, 'fastest')
  assert.equal(res.feasible, true)
  assert.ok(res.stops.length >= 1)
  // a una sosta si è caricato oltre l'80% perché necessario per finire
  assert.ok(res.stops.some((s) => s.departSocPct > 80))
})

test('fewest carica di più per ridurre le soste', () => {
  const res = planCharging({ points: [] }, makeCtx(), vehicle, params, 100, 'fewest')
  assert.equal(res.feasible, true)
})

test('SoC non scende mai sotto la riserva alle soste', () => {
  const res = planCharging({ points: [] }, makeCtx(), vehicle, params, 80, 'cheapest')
  assert.equal(res.feasible, true)
  for (const s of res.stops) assert.ok(s.arriveSocPct >= 10 - 1e-6)
})

// --- Soste di ricarica OBBLIGATORIE ---
function makeCtxBig() {
  const profile = []
  for (let d = 0; d <= 400; d += 10) profile.push({ alongKm: d, socPct: 90 - (d * 0.2) / 100 * 100, kWhFromStart: d * 0.2 })
  const stations = [{ id: 'b', name: 'B', operator: 'X', lat: 1, lng: 1, maxPowerKw: 150, alongKm: 200, detourKm: 0 }]
  return { consumption: { profile, totalKwh: 80, avgWhKm: 200 }, stations, toll: {} }
}
const vehicleBig = {
  usableKwh: 100,
  consumptionWhKm: 200,
  reserveSocPct: 10,
  defaultDepartSoc: 90,
  connectors: ['CCS'],
  chargeCurve: [{ socPct: 10, kw: 150 }, { socPct: 80, kw: 60 }, { socPct: 100, kw: 20 }],
}

test('senza soste forzate un percorso che basta -> 0 soste', () => {
  const res = planCharging({ points: [] }, makeCtxBig(), vehicleBig, { departSocPct: 90, arriveSocPct: 10 }, 80, 'fastest')
  assert.equal(res.feasible, true)
  assert.equal(res.stops.length, 0)
})

test('una sosta di ricarica OBBLIGATORIA forza la fermata anche se non necessaria', () => {
  const res = planCharging(
    { points: [] },
    makeCtxBig(),
    vehicleBig,
    { departSocPct: 90, arriveSocPct: 10, chargeStops: [{ lat: 1, lng: 1 }] },
    80,
    'fastest'
  )
  assert.equal(res.feasible, true)
  assert.equal(res.stops.length, 1)
  assert.equal(res.stops[0].forced, true)
  assert.ok(Math.abs(res.stops[0].alongKm - 200) < 2)
})

test('sosta obbligatoria vicinissima alla partenza (km<=1) viene ONORATA (no off-by-one)', () => {
  const profile = []
  for (let d = 0; d <= 400; d += 10) profile.push({ alongKm: d, socPct: 90 - (d * 0.2) / 100 * 100, kWhFromStart: d * 0.2 })
  const stations = [{ id: 's0', name: 'Start CS', operator: 'X', lat: 0.005, lng: 0.005, maxPowerKw: 150, alongKm: 0.5, detourKm: 0 }]
  const ctx = { consumption: { profile, totalKwh: 80, avgWhKm: 200 }, stations, toll: {} }
  const res = planCharging({ points: [] }, ctx, vehicleBig, { departSocPct: 90, arriveSocPct: 10, chargeStops: [{ lat: 0.005, lng: 0.005 }] }, 80, 'fastest')
  assert.equal(res.feasible, true)
  assert.equal(res.stops.length, 1)
  assert.equal(res.stops[0].forced, true)
})

test('sosta di ricarica obbligatoria senza colonnina vicina -> infeasible esplicito', () => {
  const res = planCharging(
    { points: [] },
    makeCtxBig(),
    vehicleBig,
    { departSocPct: 90, arriveSocPct: 10, chargeStops: [{ lat: 50, lng: 50 }] },
    80,
    'fastest'
  )
  assert.equal(res.feasible, false)
})
