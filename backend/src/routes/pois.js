import { poisAlongRoute } from '../services/poi.service.js'

const POIS_SCHEMA = {
  body: {
    type: 'object',
    required: ['points'],
    properties: {
      points: {
        type: 'array',
        minItems: 2,
        maxItems: 2000, // il frontend assottiglia a ~800: un tetto difende da payload abnormi
        items: {
          type: 'object',
          required: ['lat', 'lng'],
          properties: {
            lat: { type: 'number', minimum: -90, maximum: 90 },
            lng: { type: 'number', minimum: -180, maximum: 180 },
          },
        },
      },
      categories: { type: 'array', maxItems: 10, items: { type: 'string', maxLength: 30 } },
      corridorKm: { type: 'number', minimum: 0.5, maximum: 20 },
    },
  },
}

// Endpoint POI separato dal /api/plan: viene chiamato dal frontend DOPO aver mostrato il percorso,
// così la pianificazione non resta bloccata in attesa di Overpass.
export default async function poiRoutes(app) {
  app.post('/api/pois', { schema: POIS_SCHEMA }, async (req, reply) => {
    const b = req.body || {}
    const points = Array.isArray(b.points)
      ? b.points
          .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
          .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
      : []
    if (points.length < 2) {
      reply.code(400)
      return { error: 'servono almeno 2 punti del percorso', pois: [] }
    }
    try {
      const { pois, partial, failed, windows } = await poisAlongRoute(points, {
        categories: Array.isArray(b.categories) ? b.categories.filter((c) => c !== 'fuel') : ['food', 'services'],
        corridorKm: Number(b.corridorKm) || 3,
        max: 120,
      })
      return { pois, partial, failed, windows }
    } catch (e) {
      reply.code(200) // non è un errore fatale: restituiamo lista vuota con avviso
      return { pois: [], partial: true, error: 'POI non disponibili (Overpass): ' + e.message }
    }
  })
}
