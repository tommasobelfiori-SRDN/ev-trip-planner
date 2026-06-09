// Client minimale verso il backend (proxy /api -> Fastify).
// Tutte le richieste hanno un timeout: così la UI non resta mai "appesa" se il backend è lento.
async function withTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Richiesta scaduta (timeout). Riprova.')
    throw e
  } finally {
    clearTimeout(id)
  }
}

async function jget(url, timeoutMs = 20000) {
  const res = await withTimeout(url, {}, timeoutMs)
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
  return res.json()
}
async function jpost(url, body, timeoutMs = 30000) {
  const res = await withTimeout(
    url,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    timeoutMs
  )
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`)
  return res.json()
}

export const api = {
  health: () => jget('/api/health'),
  geocode: (q) => jget(`/api/geocode?q=${encodeURIComponent(q)}`),
  vehicles: () => jget('/api/vehicles'),
  prices: () => jget('/api/prices'),
  createVehicle: (v) => jpost('/api/vehicles', v),
  updateVehicle: (id, v) =>
    fetch(`/api/vehicles/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(v),
    }).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`)
      return r.json()
    }),
  deleteVehicle: (id) => fetch(`/api/vehicles/${id}`, { method: 'DELETE' }).then((r) => r.json()),
  plan: (body) => jpost('/api/plan', body, 75000),
  pois: (points, opts = {}) => jpost('/api/pois', { points, ...opts }, 50000),
  trips: () => jget('/api/trips'),
  trip: (id) => jget(`/api/trips/${id}`),
  saveTrip: (body) => jpost('/api/trips', body),
  // auth
  me: () => jget('/api/auth/me'),
  register: (email, password) => jpost('/api/auth/register', { email, password }),
  login: (email, password) => jpost('/api/auth/login', { email, password }),
  logout: () => jpost('/api/auth/logout', {}),
}
