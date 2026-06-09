import { geocode } from '../services/geocoding.service.js'

export default async function geocodeRoutes(app) {
  app.get('/api/geocode', async (req, reply) => {
    const q = (req.query?.q || '').toString()
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
