import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseOsmStation, snapBbox } from '../src/services/charging.service.js'

const base = (tags) => ({ type: 'node', id: 1, lat: 45.0, lon: 9.0, tags })

test('colonnina privata (access=private) viene scartata', () => {
  assert.equal(parseOsmStation(base({ amenity: 'charging_station', access: 'private', 'socket:type2': '2' })), null)
  assert.equal(parseOsmStation(base({ amenity: 'charging_station', access: 'no' })), null)
  assert.equal(parseOsmStation(base({ amenity: 'charging_station', access: 'customers' })), null)
})

test('colonnina solo per bici viene scartata, ma auto+bici resta', () => {
  assert.equal(parseOsmStation(base({ amenity: 'charging_station', bicycle: 'yes' })), null)
  const both = parseOsmStation(base({ amenity: 'charging_station', bicycle: 'yes', motorcar: 'yes' }))
  assert.ok(both)
  const carSocket = parseOsmStation(base({ amenity: 'charging_station', bicycle: 'yes', 'socket:type2_combo': '2' }))
  assert.ok(carSocket, 'socket CCS implica uso auto anche con bicycle=yes')
})

test('motorcar=no e stazioni in costruzione/dismesse scartate', () => {
  assert.equal(parseOsmStation(base({ amenity: 'charging_station', motorcar: 'no' })), null)
  assert.equal(parseOsmStation(base({ amenity: 'charging_station', construction: 'yes' })), null)
  assert.equal(parseOsmStation(base({ amenity: 'charging_station', disused: 'yes' })), null)
})

test('CCS è DC, Type2 è AC; capacity/fee/orari estratti', () => {
  const st = parseOsmStation(
    base({
      amenity: 'charging_station',
      'socket:type2_combo': '4',
      'socket:type2_combo:output': '300 kW',
      'socket:type2': '2',
      capacity: '6',
      fee: 'yes',
      opening_hours: '24/7',
      operator: 'Ionity',
    })
  )
  assert.ok(st.dc)
  const ccs = st.connectors.find((c) => c.title === 'CCS')
  assert.equal(ccs.powerKw, 300)
  assert.equal(ccs.dc, true)
  const t2 = st.connectors.find((c) => c.title === 'Type 2')
  assert.equal(t2.dc, false)
  assert.equal(st.capacity, 6)
  assert.equal(st.fee, 'a pagamento')
  assert.equal(st.openingHours, '24/7')
})

test('senza socket dichiarati: inferenza da maxpower (>=43 kW -> CCS DC)', () => {
  const fast = parseOsmStation(base({ amenity: 'charging_station', maxpower: '150' }))
  assert.equal(fast.dc, true)
  const slow = parseOsmStation(base({ amenity: 'charging_station' }))
  assert.equal(slow.dc, false) // assunzione prudente: AC 22 kW
})

test('snapBbox: aggancia alla griglia SEMPRE verso l\'esterno (mai restringere l\'area)', () => {
  const [s, w, n, e] = snapBbox([45.4631, 9.1772, 45.5119, 9.2458])
  assert.ok(s <= 45.4631 && w <= 9.1772, 'sud/ovest arrotondati verso il basso')
  assert.ok(n >= 45.5119 && e >= 9.2458, 'nord/est arrotondati verso l\'alto')
  // stessa zona -> stessa chiave cache anche per percorsi leggermente diversi
  assert.deepEqual(snapBbox([45.4635, 9.1775, 45.5115, 9.2455]), [s, w, n, e])
  // longitudini negative (ovest di Greenwich) gestite correttamente
  const [s2, w2] = snapBbox([-1.013, -0.013, 0.5, 0.5])
  assert.ok(s2 <= -1.013 && w2 <= -0.013)
})

test('rete DC nota senza tag socket -> DC con potenza tipica della rete', () => {
  const ionity = parseOsmStation(base({ amenity: 'charging_station', operator: 'IONITY GmbH' }))
  assert.equal(ionity.dc, true)
  assert.equal(ionity.connectors[0].powerKw, 350)
  const tesla = parseOsmStation(base({ amenity: 'charging_station', name: 'Modena Supercharger' }))
  assert.equal(tesla.dc, true)
  // operatore sconosciuto resta AC prudente
  const boh = parseOsmStation(base({ amenity: 'charging_station', operator: 'Comune di Vattelapesca' }))
  assert.equal(boh.dc, false)
})
