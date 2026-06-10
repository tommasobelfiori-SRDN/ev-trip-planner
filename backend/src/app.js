import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
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

/**
 * Factory dell'applicazione Fastify: tutta la configurazione vive qui (testabile con
 * app.inject(), senza aprire porte). server.js si limita ad avviarla.
 */
export async function buildApp(opts = {}) {
  const app = Fastify({
    logger: opts.logger ?? true,
    bodyLimit: 1 * 1024 * 1024, // 1 MB (override per-rotta dove serve, es. salvataggio viaggi)
    trustProxy: env.TRUST_PROXY, // dietro reverse proxy: rate-limit sul vero IP client
    ...opts.fastify,
  })

  // --- Sicurezza di base ---
  await app.register(helmet, { contentSecurityPolicy: false }) // API JSON: niente CSP
  await app.register(cors, { origin: true, credentials: true })
  await app.register(cookie)

  // Rate limit globale: protegge il server E le quote delle API esterne gratuite.
  // L'errore DEVE avere statusCode 429, altrimenti l'error handler lo tratta come 500.
  await app.register(rateLimit, {
    max: 120, // richieste/min per IP
    timeWindow: '1 minute',
    errorResponseBuilder: () => {
      const e = new Error('Troppe richieste: riprova tra qualche secondo.')
      e.statusCode = 429
      return e
    },
    ...opts.rateLimit, // override nei test
  })

  // --- Sessione utente (cookie) ---
  // preHandler (non onRequest): così il rate-limiter scatta PRIMA della query di sessione su DB.
  // In caso di errore degrada ad anonimo invece di rispondere 500.
  app.decorateRequest('user', null)
  app.decorateRequest('userId', null)
  app.addHook('preHandler', async (req) => {
    try {
      const token = req.cookies?.[COOKIE_NAME]
      const user = await getUserFromToken(token)
      req.user = user
      req.userId = user?.id || null
    } catch (e) {
      req.log.warn({ err: e }, 'lookup sessione fallito: richiesta trattata come anonima')
      req.user = null
      req.userId = null
    }
  })

  // --- Gestione errori centralizzata ---
  // Niente stack trace al client; messaggi uniformi; log strutturato lato server.
  app.setErrorHandler((err, req, reply) => {
    if (err.validation) {
      // errore di JSON Schema: input malformato -> 400 con dettaglio leggibile
      return reply.code(400).send({ error: 'Richiesta non valida', detail: formatValidation(err) })
    }
    if (err.statusCode === 429) {
      return reply.code(429).send({ error: 'Troppe richieste: riprova tra qualche secondo.' })
    }
    const status = err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500
    if (status >= 500) req.log.error({ err }, 'errore non gestito')
    return reply.code(status).send({ error: status >= 500 ? 'Errore interno del server' : err.message })
  })

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: 'Risorsa non trovata' })
  })

  // --- Rotte ---
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

  return app
}

// Trasforma gli errori AJV in un messaggio compatto e comprensibile.
function formatValidation(err) {
  try {
    return err.validation
      .slice(0, 3)
      .map((v) => `${err.validationContext || 'body'}${v.instancePath || ''} ${v.message}`.trim())
      .join('; ')
  } catch {
    return 'parametri non validi'
  }
}
