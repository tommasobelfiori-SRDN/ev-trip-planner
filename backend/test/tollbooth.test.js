import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dedupeBooths } from '../src/services/tollbooth.service.js'

test('caselli multi-corsia con lo stesso nome -> uno solo (entro 3 km)', () => {
  const out = dedupeBooths([
    { name: 'Barriera di Rondissone', lat: 45.24, lng: 7.97, alongKm: 23.4, gantry: false },
    { name: 'Barriera di Rondissone', lat: 45.241, lng: 7.971, alongKm: 23.5, gantry: false },
    { name: 'barriera di rondissone', lat: 45.242, lng: 7.972, alongKm: 23.6, gantry: false },
  ])
  assert.equal(out.length, 1)
  assert.equal(out[0].name, 'Barriera di Rondissone')
  assert.equal(out[0].type, 'casello')
})

test('stesso nome ma oltre 3 km (es. entrata/uscita) -> entrambi; ordinati per km', () => {
  const out = dedupeBooths([
    { name: 'Milano Est', lat: 45.5, lng: 9.3, alongKm: 120.2, gantry: false },
    { name: 'Barriera A', lat: 45.0, lng: 9.0, alongKm: 10.1, gantry: false },
    { name: 'Milano Est', lat: 45.6, lng: 9.4, alongKm: 128.9, gantry: false },
  ])
  assert.deepEqual(out.map((b) => b.alongKm), [10.1, 120.2, 128.9])
})

test('portali free-flow marcati come "portale"', () => {
  const out = dedupeBooths([{ name: 'Portale A33', lat: 44.6, lng: 7.9, alongKm: 55, gantry: true }])
  assert.equal(out[0].type, 'portale')
})

test('varianti di trattini/accenti e impianti sovrapposti (<400 m) -> uno solo', () => {
  const out = dedupeBooths([
    { name: 'Saint-Michel-Echangeur', lat: 45.2, lng: 6.47, alongKm: 122.0, gantry: false },
    { name: 'Saint Michel Echangeur', lat: 45.2, lng: 6.47, alongKm: 122.05, gantry: false },
    { name: 'Péage de Saint-Michel-de-Maurienne', lat: 45.2, lng: 6.471, alongKm: 122.1, gantry: false },
  ])
  assert.equal(out.length, 1)
})
