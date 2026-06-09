import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  tempFactor,
  speedFactor,
  chargePowerAt,
  chargeTimeMinutes,
  estimateConsumption,
} from '../src/services/consumption.service.js'

const vehicle = {
  usableKwh: 60,
  consumptionWhKm: 150,
  defaultDepartSoc: 90,
  reserveSocPct: 10,
  chargeCurve: [
    { socPct: 5, kw: 100 },
    { socPct: 20, kw: 120 },
    { socPct: 50, kw: 90 },
    { socPct: 80, kw: 50 },
    { socPct: 100, kw: 15 },
  ],
}

test('tempFactor minimo a temperatura mite, cresce al freddo', () => {
  assert.ok(tempFactor(20) <= 1.0001)
  assert.ok(tempFactor(-10) > tempFactor(20))
  assert.ok(tempFactor(0) > 1)
})

test('speedFactor: l’autostrada aumenta il consumo, la città no', () => {
  assert.ok(speedFactor(95) > 1.1) // ~autostrada -> +>10%
  assert.ok(speedFactor(95) > speedFactor(80))
  assert.ok(speedFactor(45) <= 1) // città/coda -> nessun aumento
  assert.equal(speedFactor(0), 1)
  assert.ok(speedFactor(200) <= 1.45) // limitato
})

test('estimateConsumption: a velocità autostradale consuma più che a bassa velocità', () => {
  const points = []
  for (let i = 0; i <= 100; i++) points.push({ lat: 45 + i * 0.009, lng: 9 })
  const slow = estimateConsumption(points, vehicle, { avgKmh: 50 }).totalKwh
  const fast = estimateConsumption(points, vehicle, { avgKmh: 110 }).totalKwh
  assert.ok(fast > slow * 1.1)
})

test('chargePowerAt interpola la curva', () => {
  assert.equal(chargePowerAt(vehicle.chargeCurve, 20), 120)
  const v = chargePowerAt(vehicle.chargeCurve, 35) // tra 20 (120) e 50 (90)
  assert.ok(v < 120 && v > 90)
})

test('chargeTimeMinutes cresce con la carica e rispetta il limite della colonnina', () => {
  const fast = chargeTimeMinutes(vehicle, 20, 80, 150) // limitata dalla curva
  const slow = chargeTimeMinutes(vehicle, 20, 80, 22) // limitata dalla colonnina 22 kW
  assert.ok(slow > fast)
  assert.ok(fast > 0)
})

test('estimateConsumption: SoC cala con la distanza', () => {
  // percorso rettilineo ~100 km senza elevazione
  const points = []
  for (let i = 0; i <= 100; i++) points.push({ lat: 45 + i * 0.009, lng: 9 })
  const { profile, totalKwh, avgWhKm } = estimateConsumption(points, vehicle, { departSocPct: 90, tempC: 20 })
  assert.ok(totalKwh > 0)
  assert.ok(avgWhKm > 100 && avgWhKm < 250)
  // SoC monotòna non crescente
  for (let i = 1; i < profile.length; i++) {
    assert.ok(profile[i].socPct <= profile[i - 1].socPct + 1e-6)
  }
  assert.equal(profile[0].socPct, 90)
})
