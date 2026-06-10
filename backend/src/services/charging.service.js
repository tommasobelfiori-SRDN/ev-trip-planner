import { env } from '../lib/env.js'
import { fetchJson } from '../lib/http.js'
import { cached, cacheGet, cacheSet } from '../lib/cache.js'
import { cumulativeKm, corridorBbox, nearestOnPath } from '../lib/geo.js'
import { stationMatchesNetworks } from './pricing.service.js'

// Finestre lungo il percorso per le query stazioni. PICCOLE apposta: una finestra da 80 km
// che attraversa una metropoli copre l'intera città e Overpass la uccide con 504; a 40 km
// ogni query resta leggera (<2s) e i fallimenti diventano rari.
const WINDOW_KM = 40
const MAX_WINDOWS = 30

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
  // Sulle tratte lunghissime RAGGRUPPA le finestre (mai scartarle: si creerebbero
  // "deserti" di colonnine a metà percorso).
  if (segments.length > MAX_WINDOWS) {
    const groupSize = Math.ceil(segments.length / MAX_WINDOWS)
    const grouped = []
    for (let i = 0; i < segments.length; i += groupSize) grouped.push(segments.slice(i, i + groupSize).flat())
    segments = grouped
  }
  const bboxes = segments.map((seg) => corridorBbox(seg, Math.max(corridorKm, 6)))

  const { stations: raw, failedZones, totalZones } = useOCM() ? await fetchOcmAll(bboxes) : await fetchOsmAll(bboxes)

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
  // partial=true: alcune zone non hanno risposto -> il chiamante può avvisare l'utente
  // invece di concludere "nessuna colonnina" / "tratta non percorribile".
  return { stations: result, partial: failedZones > 0, failedZones, totalZones }
}

// ---------- Provider: Open Charge Map ----------
async function fetchOcmAll(bboxes) {
  const stations = []
  let failedZones = 0
  for (const bbox of bboxes) {
    try {
      stations.push(...(await fetchOcmBbox(bbox)))
    } catch (e) {
      if (e.status === 403) {
        throw new Error(
          'Open Charge Map richiede una chiave API valida (OCM_API_KEY). Rimuovila per usare OpenStreetMap senza chiave.'
        )
      }
      failedZones++ // zona saltata: risultato parziale, non tutto-o-niente
    }
  }
  return { stations, failedZones, totalZones: bboxes.length }
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
// Una query PICCOLA per ogni finestra del percorso invece di un'unica mega-query:
// - se UNA zona va in timeout si perdono solo le sue colonnine (risultato PARZIALE, mai vuoto)
// - le bbox sono agganciate a una griglia -> percorsi simili riusano la cache della stessa zona
// - le zone girano in parallelo (3 alla volta, etiquette Overpass) con tetto di tempo ciascuna
const ZONE_SNAP = 0.02 // griglia ~2 km: stessa chiave cache tra percorsi vicini
const FLEET_BUDGET_MS = 32000 // tempo massimo per la query a Overpass: poi parziale + refill

export function snapBbox([s, w, n, e]) {
  const down = (v) => Math.floor(v / ZONE_SNAP) * ZONE_SNAP
  const up = (v) => Math.ceil(v / ZONE_SNAP) * ZONE_SNAP
  return [down(s), down(w), up(n), up(e)]
}

const ZONE_TTL_S = 60 * 60 * 24 * 3
const zoneKey = (bb) => `cs-osm-z:${bb}`
const zoneQuery = (bb) =>
  `[out:json][timeout:15];(node["amenity"="charging_station"](${bb});way["amenity"="charging_station"](${bb}););out center 6000;`

// Una stazione appartiene a una zona se cade nella sua bbox (bordo incluso).
function inBbox(st, [s, w, n, e]) {
  return st.lat >= s && st.lat <= n && st.lng >= w && st.lng <= e
}

// --- Circuit breaker SOLO per gli endpoint di riserva: a volte sono appesi (nessuna
// risposta) e senza breaker ogni zona pagherebbe il loro timeout pieno.
// L'endpoint PRINCIPALE non va mai in castigo: i suoi 429/504 durano pochi secondi,
// e metterlo in cooldown quando i backup sono giù significherebbe perdere tutto.
const BACKUP_ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]
const EP_COOLDOWN_MS = 60000
const epState = new Map() // ep -> { fails, until }
function epAvailable(ep) {
  const s = epState.get(ep)
  return !s || !s.until || s.until < Date.now()
}
function epReport(ep, ok) {
  if (ok) {
    epState.delete(ep)
    return
  }
  const s = epState.get(ep) || { fails: 0, until: 0 }
  s.fails++
  if (s.fails >= 2) s.until = Date.now() + EP_COOLDOWN_MS
  epState.set(ep, s)
}

function overpassPost(ep, query, timeoutMs = 9000) {
  return fetchJson(ep, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
    timeoutMs,
  })
}

// Fetch Overpass: principale (con UNA ripetizione dopo pausa breve: i 429 rientrano
// in pochi secondi), poi i backup ancora vivi.
async function overpassZoneFetch(query, timeoutMs = 9000) {
  let lastErr
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await overpassPost(env.OVERPASS_URL, query, timeoutMs)
    } catch (e) {
      lastErr = e
      if (attempt === 0) await new Promise((r) => setTimeout(r, 2500))
    }
  }
  for (const ep of BACKUP_ENDPOINTS) {
    if (!epAvailable(ep)) continue
    try {
      const data = await overpassPost(ep, query, timeoutMs)
      epReport(ep, true)
      return data
    } catch (e) {
      epReport(ep, false)
      lastErr = e
    }
  }
  throw lastErr || new Error('nessun endpoint Overpass disponibile')
}

async function fetchZoneCached(bb) {
  return cached(zoneKey(bb), ZONE_TTL_S, async () => {
    const data = await overpassZoneFetch(zoneQuery(bb))
    return (data.elements || []).map(parseOsmStation).filter(Boolean)
  })
}

// UNA query per tutte le zone mancanti insieme (il modo più gentile di usare Overpass:
// 1 richiesta per viaggio, non 1 per zona — il rate-limit per IP scatta sul NUMERO di
// richieste). Il risultato viene decomposto e salvato PER ZONA, così i viaggi futuri
// che passano dalle stesse zone non fanno alcuna richiesta.
async function fetchMissingZonesTogether(missingBbs) {
  const blocks = missingBbs
    .map((bb) => `node["amenity"="charging_station"](${bb});way["amenity"="charging_station"](${bb});`)
    .join('')
  const query = `[out:json][timeout:60];(${blocks});out center 8000;`
  const data = await overpassZoneFetch(query, 30000)
  const stations = (data.elements || []).map(parseOsmStation).filter(Boolean)
  // decomponi per zona e salva anche le zone VUOTE (per non rifare la query)
  await Promise.all(
    missingBbs.map((bb) => {
      const zone = bb.split(',').map(Number)
      const inZone = stations.filter((st) => inBbox(st, zone))
      return cacheSet(zoneKey(bb), inZone, ZONE_TTL_S).catch(() => {})
    })
  )
  return stations
}

// --- Ricarica in background delle zone fallite: i 429/504 di Overpass sono transitori,
// quindi riprovare dopo qualche secondo di solito riesce. Così "riprova tra poco" è VERO:
// alla ripianificazione successiva le zone mancanti sono già in cache.
const refillInFlight = new Set()
function scheduleZoneRefill(bb, attempt = 0, staggerMs = 0) {
  const delays = [5000, 15000, 35000, 80000]
  if (refillInFlight.has(bb) || attempt >= delays.length) return
  refillInFlight.add(bb)
  // staggerMs scagliona i refill di zone diverse: mai un'altra raffica verso Overpass
  const t = setTimeout(async () => {
    try {
      await fetchZoneCached(bb)
      refillInFlight.delete(bb)
    } catch {
      refillInFlight.delete(bb)
      scheduleZoneRefill(bb, attempt + 1, staggerMs)
    }
  }, delays[attempt] + staggerMs)
  t.unref?.() // non tenere vivo il processo per i refill
}

async function fetchOsmAll(bboxes) {
  const bbs = bboxes.map((b) => snapBbox(b).map((v) => v.toFixed(2)).join(','))

  // 1) Cache per zona: spesso copre tutto (0 richieste a Overpass).
  const cachedZones = await Promise.all(bbs.map((bb) => cacheGet(zoneKey(bb)).catch(() => null)))
  const stations = []
  const missing = []
  cachedZones.forEach((hit, i) => {
    if (hit !== null) stations.push(...hit)
    else missing.push(bbs[i])
  })

  if (missing.length === 0) return { stations, failedZones: 0, totalZones: bbs.length }

  // 2) UNA sola richiesta per tutte le zone mancanti (gentile col rate-limit per IP).
  //    In caso di fallimento: risultato parziale + ricarica in background zona per zona.
  const outcome = await promiseOutcome(fetchMissingZonesTogether(missing), FLEET_BUDGET_MS)
  if (outcome.ok) {
    stations.push(...outcome.value)
    return { stations, failedZones: 0, totalZones: bbs.length }
  }
  missing.forEach((bb, i) => scheduleZoneRefill(bb, 0, i * 2500))
  return { stations, failedZones: missing.length, totalZones: bbs.length }
}

/** Risolve sempre con { ok, value | error }: un fallimento/timeout non propaga rejection. */
function promiseOutcome(promise, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ ok: false, error: new Error('timeout zona') }), ms)
    promise.then(
      (value) => {
        clearTimeout(t)
        resolve({ ok: true, value })
      },
      (error) => {
        clearTimeout(t)
        resolve({ ok: false, error })
      }
    )
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

export async function overpassFetch(query, opts = {}) {
  const attempts = opts.attempts ?? 3
  const timeoutMs = opts.timeoutMs ?? 35000 // > tempo tipico, < timeout server
  const endpoints = [env.OVERPASS_URL, 'https://overpass.kumi.systems/api/interpreter']
  let lastErr
  // Più tentativi con backoff: la copertura colonnine dev'essere COMPLETA (un buco = sosta mancante).
  for (let attempt = 0; attempt < attempts; attempt++) {
    for (const ep of endpoints) {
      try {
        return await fetchJson(ep, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `data=${encodeURIComponent(query)}`,
          timeoutMs,
        })
      } catch (e) {
        lastErr = e
      }
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
  }
  throw new Error('Stazioni non disponibili (OpenStreetMap/Overpass): ' + (lastErr?.message || 'errore'))
}

export function hashStr(str) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
