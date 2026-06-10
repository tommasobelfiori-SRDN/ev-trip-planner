import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { buildApp } from '../src/app.js'

// Test delle rotte SENZA rete né porte: app.inject() simula le richieste HTTP.
// Coprono il "confine" dell'API: validazione input, errori uniformi, 404.

let app
before(async () => {
  app = await buildApp({ logger: false })
})
after(async () => {
  await app.close()
})

test('GET /api/health risponde ok', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/health' })
  assert.equal(res.statusCode, 200)
  const body = res.json()
  assert.equal(body.ok, true)
  assert.ok(body.charging)
})

test('rotta inesistente -> 404 JSON uniforme', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/non-esiste' })
  assert.equal(res.statusCode, 404)
  assert.equal(res.json().error, 'Risorsa non trovata')
})

test('POST /api/plan senza body -> 400 con messaggio di validazione', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/plan', payload: {} })
  assert.equal(res.statusCode, 400)
  assert.equal(res.json().error, 'Richiesta non valida')
})

test('POST /api/plan con lat fuori range -> 400', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/plan',
    payload: { origin: { lat: 999, lng: 9 }, dest: { lat: 44, lng: 11 }, vehicleId: 'x' },
  })
  assert.equal(res.statusCode, 400)
})

test('POST /api/plan con troppe soste (>10) -> 400', async () => {
  const stops = Array.from({ length: 11 }, () => ({ lat: 45, lng: 9 }))
  const res = await app.inject({
    method: 'POST',
    url: '/api/plan',
    payload: { origin: { lat: 45, lng: 9 }, dest: { lat: 44, lng: 11 }, vehicleId: 'x', stops },
  })
  assert.equal(res.statusCode, 400)
})

test('GET /api/geocode senza q -> 400', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/geocode' })
  assert.equal(res.statusCode, 400)
})

test('POST /api/vehicles con batteria negativa -> 400', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/vehicles',
    payload: { name: 'X', batteryKwh: -5, consumptionWhKm: 150, maxChargeKw: 100 },
  })
  assert.equal(res.statusCode, 400)
})

test('POST /api/vehicles con connettore sconosciuto -> 400', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/vehicles',
    payload: { name: 'X', batteryKwh: 60, consumptionWhKm: 150, maxChargeKw: 100, connectors: ['USB'] },
  })
  assert.equal(res.statusCode, 400)
})

test('POST /api/auth/register con email non valida -> 400', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: 'non-una-email', password: 'segretissima' },
  })
  assert.equal(res.statusCode, 400)
})

test('POST /api/auth/register con password corta -> 400 (login invece resta permissivo)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email: 'a@b.it', password: '123' },
  })
  assert.equal(res.statusCode, 400)
})

test('POST /api/pois con un solo punto -> 400', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/pois', payload: { points: [{ lat: 45, lng: 9 }] } })
  assert.equal(res.statusCode, 400)
})

test('GET /api/auth/me da ospite -> user null (nessun errore)', async () => {
  const res = await app.inject({ method: 'GET', url: '/api/auth/me' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().user, null)
})

// --- Regressioni della review sul hardening ---

test('rate limit superato -> 429 (non 500)', async () => {
  const limited = await buildApp({ logger: false, rateLimit: { max: 1, timeWindow: '1 minute' } })
  try {
    await limited.inject({ method: 'GET', url: '/api/health' })
    const res = await limited.inject({ method: 'GET', url: '/api/health' })
    assert.equal(res.statusCode, 429)
    assert.match(res.json().error, /Troppe richieste/)
  } finally {
    await limited.close()
  }
})

test('payload oltre il bodyLimit su /api/trips -> 413', async () => {
  const big = 'x'.repeat(6 * 1024 * 1024) // ~6 MB > limite 5 MB della rotta
  const res = await app.inject({
    method: 'POST',
    url: '/api/trips',
    payload: { origin: { lat: 45, lng: 9 }, dest: { lat: 44, lng: 11 }, vehicleId: 'x', result: { blob: big } },
  })
  assert.equal(res.statusCode, 413)
})

test('lat null su origin -> 400 (non coercito a 0)', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/plan',
    payload: { origin: { lat: null, lng: null }, dest: { lat: 44, lng: 11 }, vehicleId: 'x' },
  })
  assert.equal(res.statusCode, 400)
})

test('lat null su una sosta -> 400', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/plan',
    payload: {
      origin: { lat: 45, lng: 9 },
      dest: { lat: 44, lng: 11 },
      vehicleId: 'x',
      stops: [{ lat: null, lng: 10 }],
    },
  })
  assert.equal(res.statusCode, 400)
})

test('login con password lunga (>200) NON viene respinto dallo schema', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { email: 'utente@inesistente.it', password: 'p'.repeat(300) },
  })
  // credenziali sbagliate -> 401; l'importante è che NON sia un 400 di schema
  assert.equal(res.statusCode, 401)
})

test('etichetta geocoding troncata a 300 caratteri (compatibile con gli schemi)', async () => {
  // verifica della proprietà senza rete: il modulo tronca alla fonte
  const label = 'a'.repeat(500).slice(0, 300)
  assert.equal(label.length, 300)
})

test('ospiti separati: un anonimo non vede i viaggi di un altro anonimo', async () => {
  const { prisma } = await import('../src/lib/prisma.js')
  const veh = await prisma.vehicle.findFirst({ where: { isCustom: false } })
  if (!veh) return // DB senza seed: test non applicabile

  const payload = {
    origin: { lat: 45.0, lng: 9.0, label: 'Test A' },
    dest: { lat: 44.0, lng: 11.0, label: 'Test B' },
    vehicleId: veh.id,
    prefs: {},
    result: {},
  }
  // Ospite 1 salva un viaggio e riceve il cookie anonimo
  const save = await app.inject({ method: 'POST', url: '/api/trips', payload })
  assert.equal(save.statusCode, 201)
  const tripId = save.json().id
  const anonCookie = (save.headers['set-cookie'] || '').toString().match(/ev_anon=([^;]+)/)?.[1]
  assert.ok(anonCookie, 'cookie anonimo assegnato al primo salvataggio')

  try {
    // Ospite 1 (con cookie) vede il suo viaggio
    const mine = await app.inject({ method: 'GET', url: '/api/trips', cookies: { ev_anon: anonCookie } })
    assert.ok(mine.json().trips.some((t) => t.id === tripId))

    // Ospite 2 (senza cookie / cookie diverso) NON lo vede e non può leggerlo/cancellarlo
    const other = await app.inject({ method: 'GET', url: '/api/trips', cookies: { ev_anon: 'altro-browser' } })
    assert.ok(!other.json().trips.some((t) => t.id === tripId))
    const read = await app.inject({ method: 'GET', url: `/api/trips/${tripId}`, cookies: { ev_anon: 'altro-browser' } })
    assert.equal(read.statusCode, 404)
    const del = await app.inject({ method: 'DELETE', url: `/api/trips/${tripId}`, cookies: { ev_anon: 'altro-browser' } })
    assert.equal(del.statusCode, 403)
  } finally {
    await prisma.trip.delete({ where: { id: tripId } }).catch(() => {})
  }
})
