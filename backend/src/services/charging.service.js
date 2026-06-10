import { env } from '../lib/env.js'
import { fetchJson } from '../lib/http.js'
import { cached } from '../lib/cache.js'
import { cumulativeKm, corridorBbox, nearestOnPath } from '../lib/geo.js'
import { stationMatchesNetworks } from './pricing.service.js'

const WINDOW_KM = 80 // finestre lungo il percorso per le query stazioni
const MAX_WINDOWS = 18

// Parole chiave per riconoscere il tipo di connettore dal titolo.
const CONNECTOR_KEYWORDS = {
  CCS: ['ccs', 'combo'],
  CHAdeMO: ['chademo'],
  Type2: ['type 2', 'type2', 'mennekes', 'iec 62196-2'],
}

function connectionMatches(connectorTitle, wanted) {
  const t = (connectorTitle || '').toLowerCase()
  return wanted.some((c) => (CONNECTOR_KEYWORDS[c] || []).some((kw) => t.includes(kw)))
}

const useOCM = () => !!env.OCM_API_KEY

/** Quale fonte stazioni è in uso (per health/diagnostica). */
export function chargingProvider() {
  return useOCM() ? 'openchargemap' : 'openstreetmap'
}

/**
 * Colonnine compatibili entro `corridorKm` dal percorso.
 * Fonte: Open Charge Map se è configurata OCM_API_KEY, altrimenti OpenStreetMap (Overpass, senza chiave).
 */
export async function stationsNearRoute(points, opts = {}) {
  const connectors = opts.connectors?.length ? opts.connectors : ['CCS', 'Type2', 'CHAdeMO']
  const minPowerKw = opts.minPowerKw ?? 0
  const corridorKm = opts.corridorKm ?? 5
  const networks = opts.networks || [] // reti/operatori selezionati (vuoto = tutte)

  const cum = cumulativeKm(points)
  const total = cum[cum.length - 1]

  // Finestre -> bounding box (con tetto su tratte lunghe).
  let segments = []
  for (let start = 0; start < total; start += WINDOW_KM) {
    const end = Math.min(total, start + WINDOW_KM)
    const seg = points.filter((_, i) => cum[i] >= start - 2 && cum[i] <= end + 2)
    if (seg.length >= 2) segments.push(seg)
  }
  if (segments.length === 0) segments.push(points)
  if (segments.length > MAX_WINDOWS) {
    const step = Math.ceil(segments.length / MAX_WINDOWS)
    segments = segments.filter((_, i) => i % step === 0)
  }
  const bboxes = segments.map((seg) => corridorBbox(seg, Math.max(corridorKm, 6)))

  const raw = useOCM() ? await fetchOcmAll(bboxes) : await fetchOsmAll(bboxes)

  // Filtra per connettore/potenza/corridoio e arricchisci con posizione lungo il percorso.
  const byId = new Map()
  for (const st of raw) byId.set(st.id, st)

  const result = []
  for (const st of byId.values()) {
    if (!stationMatchesNetworks(st.operator, networks)) continue
    const compatible = st.connectors.filter((c) => connectionMatches(c.title, connectors))
    if (compatible.length === 0) continue
    // Potenza separata DC (rapida, segue la curva del veicolo) e AC (limitata dal caricatore di bordo).
    const isDc = (c) => c.dc ?? /ccs|combo|chademo/i.test(c.title || '')
    const dcKw = Math.max(0, ...st.connectors.filter(isDc).map((c) => c.powerKw || 0))
    const acKw = Math.max(0, ...st.connectors.filter((c) => !isDc(c)).map((c) => c.powerKw || 0))
    const maxPowerKw = Math.max(dcKw, acKw)
    if (maxPowerKw < minPowerKw) continue
    const near = nearestOnPath(points, cum, st)
    if (near.distKm > corridorKm) continue
    result.push({
      id: st.id,
      name: st.name,
      operator: st.operator,
      lat: st.lat,
      lng: st.lng,
      maxPowerKw,
      dc: dcKw > 0,
      dcKw,
      acKw,
      capacity: st.capacity ?? null,
      fee: st.fee ?? null,
      openingHours: st.openingHours ?? null,
      connectors: st.connectors.map((c) => ({ title: c.title, powerKw: c.powerKw })),
      alongKm: near.alongKm,
      detourKm: near.distKm,
    })
  }
  result.sort((a, b) => a.alongKm - b.alongKm)
  return result
}

// ---------- Provider: Open Charge Map ----------
async function fetchOcmAll(bboxes) {
  const out = []
  for (const bbox of bboxes) {
    let rows
    try {
      rows = await fetchOcmBbox(bbox)
    } catch (e) {
      if (e.status === 403) {
        throw new Error(
          'Open Charge Map richiede una chiave API valida (OCM_API_KEY). Rimuovila per usare OpenStreetMap senza chiave.'
        )
      }
      throw e
    }
    out.push(...rows)
  }
  return out
}

async function fetchOcmBbox(bbox) {
  const [south, west, north, east] = bbox
  const key = `ocm:${south.toFixed(2)},${west.toFixed(2)},${north.toFixed(2)},${east.toFixed(2)}`
  return cached(key, 60 * 60 * 24 * 3, async () => {
    const url = new URL('/poi/', env.OCM_URL)
    url.searchParams.set('output', 'json')
    url.searchParams.set('compact', 'true')
    url.searchParams.set('verbose', 'false')
    url.searchParams.set('maxresults', '500')
    url.searchParams.set('boundingbox', `(${north},${west}),(${south},${east})`)
    if (env.OCM_API_KEY) url.searchParams.set('key', env.OCM_API_KEY)
    const rows = await fetchJson(url.toString())
    return (rows || [])
      .filter((r) => r.AddressInfo)
      .map((r) => ({
        id: `ocm:${r.ID}`,
        name: r.AddressInfo.Title,
        operator: r.OperatorInfo?.Title || null,
        lat: r.AddressInfo.Latitude,
        lng: r.AddressInfo.Longitude,
        connectors: (r.Connections || []).map((c) => ({
          title: c.ConnectionType?.Title || '',
          powerKw: c.PowerKW || ocmLevelToKw(c.LevelID),
        })),
      }))
  })
}

function ocmLevelToKw(levelId) {
  if (levelId === 3) return 50
  if (levelId === 2) return 22
  return 7
}

// ---------- Provider: OpenStreetMap (Overpass, senza chiave) ----------
// UNA sola query (veloce: ~10-15s anche su 1000+ km, niente serializzazione) con cap molto alto
// così non si troncano le colonnine rapide. La densità di charging_station è bassa: gestibile.
async function fetchOsmAll(bboxes) {
  const blocks = []
  for (const bbox of bboxes) {
    const [s, w, n, e] = bbox
    const bb = `${s.toFixed(4)},${w.toFixed(4)},${n.toFixed(4)},${e.toFixed(4)}`
    blocks.push(`node["amenity"="charging_station"](${bb});`)
    blocks.push(`way["amenity"="charging_station"](${bb});`)
  }
  const query = `[out:json][timeout:60];(${blocks.join('')});out center 8000;`
  const key = `cs-osm:${hashStr(blocks.join('|'))}`
  return cached(key, 60 * 60 * 24 * 3, async () => {
    const data = await overpassFetch(query)
    return (data.elements || []).map(parseOsmStation).filter(Boolean)
  })
}

// Reti di ricarica RAPIDA note: se la colonnina appartiene a una di queste, è DC anche
// senza tag socket (potenza tipica della rete, prudente).
const DC_NETWORKS = [
  [/ionity/i, 350],
  [/supercharger|tesla/i, 250],
  [/free\s*to\s*x|freetox/i, 300],
  [/ewiva/i, 300],
  [/electra/i, 300],
  [/fastned/i, 300],
  [/atlante/i, 150],
  [/aral\s*pulse|bp\s*pulse/i, 300],
  [/enbw/i, 300],
  [/allego/i, 150],
]

function dcNetworkKw(text) {
  for (const [re, kw] of DC_NETWORKS) if (re.test(text)) return kw
  return null
}

// Gruppi di socket OSM -> connettore standard. (type2_combo = CCS, NON Type 2.)
const OSM_SOCKETS = [
  { title: 'CCS', keys: ['type2_combo', 'ccs', 'tesla_supercharger', 'tesla_supercharger_ccs'], dc: true },
  { title: 'CHAdeMO', keys: ['chademo'], dc: true },
  { title: 'Type 2', keys: ['type2', 'type2_cable', 'mennekes', 'scame'], dc: false },
]

export function parseOsmStation(el) {
  const tags = el.tags || {}
  const lat = el.lat ?? el.center?.lat
  const lng = el.lon ?? el.center?.lon // Overpass `out center` usa center.lon (NON .lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null

  // --- Affidabilità: scarta le colonnine NON utilizzabili in viaggio ---
  // 1) accesso privato/vietato (wallbox aziendali, garage privati…)
  if (['private', 'no', 'customers'].includes(tags.access)) return null
  // 2) stazioni solo per bici/scooter (auto esplicitamente esclusa o solo mezzi leggeri)
  if (tags.motorcar === 'no' || tags.car === 'no') return null
  const onlyLight =
    (tags.bicycle === 'yes' || tags.scooter === 'yes') && tags.motorcar !== 'yes' && tags.car !== 'yes'
  const hasCarSocket = Object.keys(tags).some(
    (k) => k.startsWith('socket:') && !/small_electric|bike|schuko/.test(k) && tags[k] !== 'no'
  )
  if (onlyLight && !hasCarSocket) return null
  // 3) non ancora costruita / dismessa
  if (tags.construction || tags.proposed || tags.disused === 'yes' || tags['disused:amenity']) return null

  const maxKw = parseKw(tags.maxpower) || parseKw(tags['charging_station:output'])
  const connectors = []
  for (const grp of OSM_SOCKETS) {
    let present = false
    let outputKw = null
    for (const k of grp.keys) {
      const v = tags[`socket:${k}`]
      if (v !== undefined && v !== 'no' && v !== '0') {
        present = true
        outputKw = outputKw || parseKw(tags[`socket:${k}:output`])
      }
    }
    if (present) {
      connectors.push({ title: grp.title, powerKw: outputKw || maxKw || (grp.dc ? 50 : 22), dc: grp.dc })
    }
  }

  // Nessun socket dichiarato: inferisci da maxpower, dalla RETE (alcune sono DC per definizione)
  // o, in ultima istanza, assumi prudentemente AC 22 kW.
  if (connectors.length === 0) {
    const netKw = dcNetworkKw(`${tags.operator || ''} ${tags.network || ''} ${tags.brand || ''} ${tags.name || ''}`)
    if (maxKw && maxKw >= 43) connectors.push({ title: 'CCS', powerKw: maxKw, dc: true })
    else if (netKw) connectors.push({ title: 'CCS', powerKw: maxKw || netKw, dc: true })
    else connectors.push({ title: 'Type 2', powerKw: maxKw || 22, dc: false })
  }

  return {
    id: `osm:${el.type}/${el.id}`,
    name: tags.name || tags.brand || tags.network || tags.operator || 'Stazione di ricarica',
    operator: tags.operator || tags.network || tags.brand || null,
    lat,
    lng,
    connectors,
    dc: connectors.some((c) => c.dc), // almeno un connettore in corrente continua (ricarica rapida)
    capacity: Number(tags.capacity) || null, // numero di stalli, se dichiarato
    fee: tags.fee === 'no' ? 'gratis' : tags.fee === 'yes' ? 'a pagamento' : null,
    openingHours: tags.opening_hours || null,
  }
}

// "50 kW" / "22" / "150000" (W) -> kW
function parseKw(str) {
  if (!str) return null
  const m = String(str).match(/([\d.]+)/)
  if (!m) return null
  let v = parseFloat(m[1])
  if (!Number.isFinite(v)) return null
  if (/kw/i.test(str)) return Math.round(v)
  if (v > 1000) return Math.round(v / 1000) // valore in Watt
  return Math.round(v)
}

async function overpassFetch(query) {
  const endpoints = [env.OVERPASS_URL, 'https://overpass.kumi.systems/api/interpreter']
  let lastErr
  // Più tentativi con backoff: la copertura colonnine dev'essere COMPLETA (un buco = sosta mancante).
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const ep of endpoints) {
      try {
        return await fetchJson(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          timeoutMs: 35000, // > tempo tipico (~12-15s), < timeout server [timeout:60]
        })
      } catch (e) {
        lastErr = e
      }
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
  }
  throw new Error('Stazioni non disponibili (OpenStreetMap/Overpass): ' + (lastErr?.message || 'errore'))
}

function hashStr(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
