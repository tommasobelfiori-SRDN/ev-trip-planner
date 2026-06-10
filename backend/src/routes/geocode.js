import { geocode } from '../services/geocoding.service.js'

const GEOCODE_SCHEMA = {
  querystring: {
    type: 'object',
    required: ['q'],
    // tetto generoso anti-DoS: il troncamento "utile" avviene nel handler (slice a 200)
    properties: { q: { type: 'string', minLength: 1, maxLength: 1000 } },
  },
}

export default async function geocodeRoutes(app) {
  app.get('/api/geocode', { schema: GEOCODE_SCHEMA }, async (req, reply) => {
    const q = (req.query?.q || '').toString().slice(0, 200)
    if (q.trim().length < 2) return { results: [] }
    try {
      const results = await geocode(q)
      return { results }
    } catch (e) {
      reply.code(502)
      return { error: 'geocoding non disponibile', detail: e.message, results: [] }
    }
  })
}
