import { poisAlongRoute } from '../services/poi.service.js'

// Endpoint POI separato dal /api/plan: viene chiamato dal frontend DOPO aver mostrato il percorso,
// così la pianificazione non resta bloccata in attesa di Overpass.
export default async function poiRoutes(app) {
  app.post('/api/pois', async (req, reply) => {
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
