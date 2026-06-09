import './lib/env.js'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import { env } from './lib/env.js'
import geocodeRoutes from './routes/geocode.js'
import vehicleRoutes from './routes/vehicles.js'
import planRoutes from './routes/plan.js'
import poiRoutes from './routes/pois.js'
import tripRoutes from './routes/trips.js'
import authRoutes from './routes/auth.js'
import { priceList } from './services/pricing.service.js'
import { chargingProvider } from './services/charging.service.js'
import { getUserFromToken, COOKIE_NAME } from './services/auth.service.js'

const app = Fastify({
  logger: true,
  bodyLimit: 5 * 1024 * 1024,
})

await app.register(cors, { origin: true, credentials: true })
await app.register(cookie)

// Popola req.user / req.userId leggendo il cookie di sessione (null se ospite).
app.decorateRequest('user', null)
app.decorateRequest('userId', null)
app.addHook('onRequest', async (req) => {
  const token = req.cookies?.[COOKIE_NAME]
  const user = await getUserFromToken(token)
  req.user = user
  req.userId = user?.id || null
})

app.get('/api/health', async () => ({
  ok: true,
  routing: env.ORS_API_KEY ? 'openrouteservice' : 'osrm (no avoid tolls/highways)',
  charging: chargingProvider(),
  toll: env.TOLLGURU_API_KEY ? 'tollguru' : 'stima interna',
}))

app.get('/api/prices', async () => priceList())

await app.register(authRoutes)
await app.register(geocodeRoutes)
await app.register(vehicleRoutes)
await app.register(planRoutes)
await app.register(poiRoutes)
await app.register(tripRoutes)

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
