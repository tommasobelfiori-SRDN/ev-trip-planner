import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tollFromDistances } from '../src/services/toll.service.js'

test('Italia: pedaggio a barriera proporzionale ai km', () => {
  const r = tollFromDistances({ IT: 200 })
  const it = r.breakdown.find((b) => b.country === 'IT')
  assert.equal(it.model, 'perKm')
  assert.ok(r.total > 8 && r.total < 16) // ~200*0.88*0.07
  assert.equal(r.vignetteTotal, 0)
})

test('Austria: vignetta a costo fisso (indipendente dai km), elencata esplicitamente', () => {
  const r1 = tollFromDistances({ AT: 50 })
  const r2 = tollFromDistances({ AT: 500 })
  assert.equal(r1.vignetteTotal, r2.vignetteTotal)
  assert.ok(r1.vignetteTotal > 0)
  const v = r1.vignettes.find((x) => x.country === 'AT')
  assert.ok(v && v.required && v.purchaseUrl && v.cheapest)
  assert.equal(r1.total, 0) // l'Austria non ha pedaggio a barriera per km
})

test('Cechia: auto elettrica ESENTE dalla vignetta', () => {
  const ev = tollFromDistances({ CZ: 100 }, { isEv: true })
  const vEv = ev.vignettes.find((x) => x.country === 'CZ')
  assert.ok(vEv && vEv.exemptEv === true)
  assert.equal(ev.vignetteTotal, 0)
  const ice = tollFromDistances({ CZ: 100 }, { isEv: false })
  assert.ok(ice.vignetteTotal > 0) // non elettrica paga
})

test('Germania: autostrade gratuite, nessuna vignetta', () => {
  const r = tollFromDistances({ DE: 300 })
  assert.equal(r.total, 0)
  assert.equal(r.vignetteTotal, 0)
  assert.equal(r.vignettes.length, 0)
})

test('Tratta IT+AT+DE: pedaggio barriera (IT) + vignetta (AT) separati', () => {
  const r = tollFromDistances({ IT: 200, AT: 100, DE: 250 })
  assert.ok(r.total > 0) // IT barriera
  assert.ok(r.vignetteTotal > 0) // AT vignetta
  assert.ok(r.vignettes.some((v) => v.country === 'AT'))
})
