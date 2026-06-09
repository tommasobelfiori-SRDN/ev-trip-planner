import { useEffect, useRef, useState } from 'react'
import maplibregl from 'maplibre-gl'
import { useStore } from '../store.js'
import { setMap } from '../mapRef.js'

// Stile raster OSM inline (nessuna API key). Lo stile è locale -> l'evento "load" scatta
// sempre, anche se qualche tile è lento; molto più robusto del vector (che richiede
// style.json + glyphs + sprite via rete).
const RASTER_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

const EMPTY_FC = { type: 'FeatureCollection', features: [] }

export default function Map() {
  const mapRef = useRef(null)
  const containerRef = useRef(null)
  const roRef = useRef(null)
  const fittedRef = useRef(null) // ultima rotta inquadrata (per non rifare fitBounds di continuo)
  const [ready, setReady] = useState(false)

  const planResult = useStore((s) => s.planResult)
  const selectedOptionId = useStore((s) => s.selectedOptionId)
  const poiFilter = useStore((s) => s.poiFilter)
  const poisData = useStore((s) => s.pois)
  const origin = useStore((s) => s.origin)
  const dest = useStore((s) => s.dest)
  const stops = useStore((s) => s.stops)

  // init mappa (gestisce anche il doppio-mount di StrictMode in sviluppo)
  useEffect(() => {
    const map = new maplibregl.Map({
      container: containerRef.current,
      // clona lo stile: MapLibre lo muta internamente, condividerlo tra istanze (StrictMode) lo corrompe
      style: JSON.parse(JSON.stringify(RASTER_STYLE)),
      center: [9.19, 45.46],
      zoom: 5,
      preserveDrawingBuffer: true, // consente la cattura del canvas (export PDF)
    })
    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    mapRef.current = map
    setMap(map)
    if (import.meta.env?.DEV) window.__evMap = map

    const ro = new ResizeObserver(() => map.resize())
    ro.observe(containerRef.current)
    roRef.current = ro

    // Inizializza appena lo STILE è pronto (non aspetta i tile di base): così il percorso e
    // i marker si disegnano anche se i tile sono lenti o irraggiungibili.
    const initLayers = () => {
      if (!map.isStyleLoaded() || map.getLayer('route-line')) return
      addLayers(map)
      bindPopups(map)
      if (import.meta.env?.DEV) window.__evMap = map
      setReady(true)
    }
    map.on('styledata', initLayers)
    map.on('load', initLayers)

    return () => {
      setReady(false)
      roRef.current?.disconnect()
      mapRef.current = null
      map.remove()
    }
  }, [])

  // applica i dati quando la mappa è pronta o cambiano i dati
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !map.getSource('route')) return

    // endpoints
    const epFeatures = []
    if (origin) epFeatures.push(pt(origin, { kind: 'origin' }))
    for (const s of stops || []) if (s && Number.isFinite(s.lat)) epFeatures.push(pt(s, { kind: s.type || 'passaggio' }))
    if (dest) epFeatures.push(pt(dest, { kind: 'dest' }))
    map.getSource('endpoints').setData({ type: 'FeatureCollection', features: epFeatures })

    const option = planResult?.options?.find((o) => o.id === selectedOptionId) || planResult?.options?.[0]

    if (option?.points?.length) {
      const coords = option.points.map((p) => [p.lng, p.lat])
      map.getSource('route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} })
    } else {
      map.getSource('route').setData(EMPTY_FC)
    }

    const stopFeatures = (option?.stops || []).map((s, i) =>
      pt(s, { idx: String(i + 1), name: s.name, popup: stopPopup(s, i + 1) })
    )
    map.getSource('stops').setData({ type: 'FeatureCollection', features: stopFeatures })

    const pois = (poisData || []).filter((p) => poiFilter[p.category])
    const poiFeatures = pois.map((p) => pt(p, { category: p.category, name: p.name, popup: poiPopup(p) }))
    map.getSource('pois').setData({ type: 'FeatureCollection', features: poiFeatures })
  }, [ready, planResult, selectedOptionId, poiFilter, poisData, origin, dest, stops])

  // Inquadra il percorso SOLO quando cambia la geometria della rotta (non a ogni modifica di sosta/POI).
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const option = planResult?.options?.find((o) => o.id === selectedOptionId) || planResult?.options?.[0]
    if (!option?.points?.length) return
    const coords = option.points.map((p) => [p.lng, p.lat])
    const key = `${coords.length}:${coords[0]}:${coords[coords.length - 1]}`
    if (fittedRef.current === key) return // stessa rotta già inquadrata
    fittedRef.current = key
    const b = coords.reduce((bb, c) => bb.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]))
    map.resize()
    map.fitBounds(b, { padding: 60, duration: 0, maxZoom: 12 })
  }, [ready, planResult, selectedOptionId])

  return <div ref={containerRef} className="absolute inset-0" />
}

function addLayers(map) {
  map.addSource('route', { type: 'geojson', data: EMPTY_FC })
  map.addLayer({
    id: 'route-line',
    type: 'line',
    source: 'route',
    paint: { 'line-color': '#16a34a', 'line-width': 5, 'line-opacity': 0.85 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  })

  map.addSource('endpoints', { type: 'geojson', data: EMPTY_FC })
  map.addLayer({
    id: 'endpoints-circle',
    type: 'circle',
    source: 'endpoints',
    paint: {
      'circle-radius': 7,
      'circle-color': [
        'match',
        ['get', 'kind'],
        'origin', '#2563eb',
        'passaggio', '#7c3aed',
        'ricarica', '#0d9488',
        'riposo', '#d97706',
        '#dc2626',
      ],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
    },
  })

  map.addSource('pois', { type: 'geojson', data: EMPTY_FC })
  map.addLayer({
    id: 'pois-circle',
    type: 'circle',
    source: 'pois',
    paint: {
      'circle-radius': 4,
      'circle-color': ['match', ['get', 'category'], 'food', '#f59e0b', 'services', '#0891b2', '#94a3b8'],
      'circle-stroke-width': 1,
      'circle-stroke-color': '#fff',
    },
  })

  map.addSource('stops', { type: 'geojson', data: EMPTY_FC })
  map.addLayer({
    id: 'stops-circle',
    type: 'circle',
    source: 'stops',
    paint: { 'circle-radius': 8, 'circle-color': '#16a34a', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' },
  })
}

function pt(o, props) {
  return { type: 'Feature', geometry: { type: 'Point', coordinates: [o.lng, o.lat] }, properties: props }
}

function bindPopups(map) {
  const popup = new maplibregl.Popup({ closeButton: false, offset: 12 })
  for (const layer of ['stops-circle', 'pois-circle']) {
    map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = ''
      popup.remove()
    })
    map.on('click', layer, (e) => {
      const f = e.features?.[0]
      if (!f) return
      popup.setLngLat(e.lngLat).setHTML(f.properties.popup || f.properties.name || '').addTo(map)
    })
  }
}

function stopPopup(s, idx) {
  return `<b>Sosta ${idx}: ${esc(s.name)}</b><br/>${esc(s.operator || 'operatore n/d')}<br/>
  ⚡ ${s.powerKw} kW · ${s.arriveSocPct}%→${s.departSocPct}%<br/>
  ⏱ ${s.chargeMinutes} min · +${s.energyAddedKwh} kWh · €${s.cost}`
}
function poiPopup(p) {
  const cat = { food: '🍽 Cibo', fuel: '⛽ Carburante', services: '🅿️ Area di servizio' }[p.category] || 'POI'
  return `<b>${esc(p.name)}</b><br/>${cat}${p.tags?.cuisine ? '<br/>' + esc(p.tags.cuisine) : ''}`
}
function esc(s) {
  return String(s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])
}
