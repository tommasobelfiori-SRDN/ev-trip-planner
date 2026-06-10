import { route } from './routing.service.js'
import { stationsNearRoute } from './charging.service.js'
import { estimateToll } from './toll.service.js'
import { estimateConsumption, chargeTimeMinutes } from './consumption.service.js'
import { priceForOperator, HOME_PRICE } from './pricing.service.js'
import { addElevation, routeTemperature } from './openmeteo.service.js'
import { haversineKm, cumulativeKm, nearestOnPath } from '../lib/geo.js'
import { appsForOperators } from './apps.service.js'

// Caricatore di bordo AC tipico (Type 2): la ricarica in corrente alternata è limitata
// dall'auto (~11 kW), NON dalla potenza della colonnina né dalla curva DC.
const AC_ONBOARD_KW = 11

/** Potenza di ricarica EFFETTIVA a una stazione: DC segue la curva, AC è cap dal veicolo. */
function stationChargeKw(s) {
  if (s.dc) return s.dcKw || s.maxPowerKw || 50
  return Math.min(s.acKw || s.maxPowerKw || 22, AC_ONBOARD_KW)
}

// Esegue una promise con un tetto di tempo: oltre il limite restituisce il fallback.
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ])
}

const MODES = {
  fastest: { label: 'Più veloce', capSoc: 80 },
  fewest: { label: 'Meno soste', capSoc: 100 },
  cheapest: { label: 'Più economico', capSoc: 92 },
}

/**
 * Pianifica un viaggio EV e restituisce 2-3 opzioni (più veloce / più economico / meno soste).
 */
export async function planTrip(params) {
  const { origin, dest } = params
  const warnings = []

  // Salute batteria (%): degrado reale -> capacità utilizzabile ridotta in tutti i calcoli.
  const healthPct = Math.min(100, Math.max(50, Number(params.batteryHealthPct) || 100))
  const vehicle =
    healthPct < 100
      ? { ...params.vehicle, usableKwh: (params.vehicle.usableKwh * healthPct) / 100 }
      : params.vehicle
  params.vehicle = vehicle

  // Soste scelte dall'utente (passaggio / ricarica / riposo). Tutte sono punti di passaggio del percorso.
  const stops = (Array.isArray(params.stops) ? params.stops : Array.isArray(params.waypoints) ? params.waypoints : [])
    .filter((s) => s && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng)))
    .map((s) => ({
      lat: Number(s.lat),
      lng: Number(s.lng),
      label: s.label,
      type: s.type || 'passaggio',
      durationMin: Number(s.durationMin) || 0,
      targetSocPct: Number.isFinite(Number(s.targetSocPct)) ? Number(s.targetSocPct) : null,
    }))
  const waypoints = [origin, ...stops.map((s) => ({ lat: s.lat, lng: s.lng })), dest]
  // Pause di riposo: minuti aggiunti al tempo totale. Soste di ricarica obbligatorie: luoghi dove fermarsi.
  params.restMinutes = stops.filter((s) => s.type === 'riposo').reduce((sum, s) => sum + s.durationMin, 0)
  params.chargeStops = stops
    .filter((s) => s.type === 'ricarica')
    .map((s) => ({ lat: s.lat, lng: s.lng, targetSocPct: s.targetSocPct }))
  params.userStops = stops // tutte le soste utente (con tipo/label), per i marker del grafico SoC

  // 1) Percorso base (con eventuali toggle evita pedaggi/autostrade scelti dall'utente).
  const baseRoute = await route(waypoints, {
    avoidTolls: params.avoidTolls,
    avoidHighways: params.avoidHighways,
  })
  warnings.push(...baseRoute.warnings)

  // 1b) Elevazione reale (Open-Meteo) se il router non la fornisce: salite/discese nel consumo.
  if (!baseRoute.hasElevation) {
    try {
      const ok = await withTimeout(addElevation(baseRoute.points), 9000, false)
      if (ok) baseRoute.hasElevation = true
    } catch {
      /* senza elevazione: consumo piatto, come prima */
    }
  }

  // 1c) Temperatura prevista lungo il percorso (Open-Meteo) all'orario di partenza.
  let weather = null
  if (params.useWeather !== false) {
    try {
      weather = await withTimeout(routeTemperature(baseRoute.points, params.departureTime), 8000, null)
      if (weather && Number.isFinite(weather.tempC)) params.tempC = weather.tempC
    } catch {
      weather = null // fallback: temperatura manuale dello slider
    }
  }

  // 2) Dati per la geometria base.
  const ctxBase = await gatherForRoute(baseRoute, params)

  // 3) I POI NON vengono calcolati qui: sono lenti (Overpass) e bloccherebbero la risposta.
  //    Il frontend li carica a parte via POST /api/pois dopo aver mostrato il percorso.

  // 4) Costruisci le opzioni.
  const options = []
  for (const mode of ['fastest', 'cheapest', 'fewest']) {
    options.push(buildOption(mode, baseRoute, ctxBase, params))
  }

  // 4b) Auto-relax: se nessuna opzione è percorribile a causa del filtro "potenza minima",
  // riprova includendo colonnine più lente (le reti scelte restano rispettate).
  // Solo se le colonnine sono state recuperate davvero (non per timeout/errore): in quel caso
  // ri-filtriamo da cache (stessi bbox => istantaneo) senza la soglia di potenza.
  if (options.every((o) => !o.feasible) && (params.minPowerKw ?? 0) > 0 && !ctxBase.stationError) {
    try {
      const relaxedParams = { ...params, minPowerKw: 0 }
      const relaxedStations = await withTimeout(
        stationsNearRoute(baseRoute.points, {
          connectors: vehicle.connectors,
          minPowerKw: 0,
          corridorKm: params.corridorKm ?? 5,
          networks: params.networks || [],
        }),
        12000,
        ctxBase.stations
      )
      const ctxRelaxed = { ...ctxBase, stations: relaxedStations, stationError: null }
      const relaxedOptions = ['fastest', 'cheapest', 'fewest'].map((m) => buildOption(m, baseRoute, ctxRelaxed, relaxedParams))
      if (relaxedOptions.some((o) => o.feasible)) {
        options.length = 0
        options.push(...relaxedOptions)
        warnings.push(
          `Nessuna colonnina ≥${params.minPowerKw} kW sufficiente lungo il percorso: incluse anche colonnine più lente (i tempi di ricarica aumentano).`
        )
      }
    } catch {
      // mantieni le opzioni non percorribili (con il messaggio azionabile)
    }
  }

  // 5) Variante "senza pedaggi" per l'opzione economica (solo se conviene e se ORS disponibile).
  if (
    baseRoute.provider === 'openrouteservice' &&
    !params.avoidTolls &&
    ctxBase.toll.total > 0
  ) {
    try {
      const altRoute = await route(waypoints, { avoidTolls: true, avoidHighways: params.avoidHighways })
      const ctxAlt = await gatherForRoute(altRoute, { ...params, avoidTolls: true })
      const altCheapest = buildOption('cheapest', altRoute, ctxAlt, { ...params, avoidTolls: true })
      const idx = options.findIndex((o) => o.id === 'cheapest')
      if (altCheapest.feasible && altCheapest.cost.total < options[idx].cost.total) {
        altCheapest.label = 'Più economico (senza pedaggi)'
        altCheapest.avoidedTolls = true
        options[idx] = altCheapest
      }
    } catch (e) {
      // ignora: manteniamo l'opzione economica sul percorso base
    }
  }

  if (ctxBase.toll?.method === 'timeout') {
    warnings.push('Stima pedaggi non disponibile (timeout): riprova o configura TOLLGURU_API_KEY.')
  }

  // App di ricarica da installare: dagli operatori delle soste di tutte le opzioni.
  const usedOperators = [...new Set(options.flatMap((o) => o.stops.map((s) => s.operator)).filter(Boolean))]
  const chargingApps = appsForOperators(usedOperators)

  // Tutte le colonnine candidate lungo il corridoio (per il layer mappa), proiezione leggera.
  const stations = (ctxBase.stations || []).slice(0, 400).map((s) => ({
    id: s.id,
    name: s.name,
    operator: s.operator,
    lat: s.lat,
    lng: s.lng,
    maxPowerKw: s.maxPowerKw,
    dc: !!s.dc,
    capacity: s.capacity,
    fee: s.fee,
    openingHours: s.openingHours,
    alongKm: round1(s.alongKm),
  }))

  return {
    origin,
    dest,
    vehicle: { id: vehicle.id, name: vehicle.name },
    provider: baseRoute.provider,
    options,
    stations,
    weather: weather ? { tempC: weather.tempC, source: 'open-meteo' } : null,
    elevation: !!baseRoute.hasElevation,
    pois: [], // caricati separatamente dal frontend (/api/pois)
    toll: ctxBase.toll,
    chargingApps,
    warnings: [...new Set(warnings)].filter(Boolean),
  }
}

/** Raccoglie consumo, colonnine e pedaggi per una specifica geometria di percorso. */
async function gatherForRoute(routeResult, params) {
  const avgKmh = routeResult.durationS > 0 ? routeResult.distanceKm / (routeResult.durationS / 3600) : 0
  const consumption = estimateConsumption(routeResult.points, params.vehicle, {
    departSocPct: params.departSocPct,
    tempC: params.tempC,
    avgKmh,
  })

  // Stazioni (OSM/OCM) e pedaggi (Nominatim) usano host diversi: lanciali in PARALLELO, con tetto di tempo.
  const stationsP = withTimeout(
    stationsNearRoute(routeResult.points, {
      connectors: params.vehicle.connectors,
      minPowerKw: params.minPowerKw ?? 0,
      corridorKm: params.corridorKm ?? 5,
      networks: params.networks || [],
    })
      .then((stations) => ({ stations, stationError: null }))
      .catch((e) => ({ stations: [], stationError: e.message })),
    24000,
    { stations: [], stationError: 'Stazioni non disponibili (timeout). Riprova tra poco.' }
  )
  const tollP = withTimeout(
    estimateToll(routeResult.points, {
      avoidTolls: params.avoidTolls,
      avoidHighways: params.avoidHighways,
      isEv: true,
      // giorni di viaggio stimati (~9h di guida al giorno) per scegliere la vignetta giusta
      tripDays: Math.max(1, Math.ceil(routeResult.durationS / 3600 / 9)),
    }),
    18000,
    {
      total: 0,
      vignetteTotal: 0,
      currency: 'EUR',
      method: 'timeout',
      disclaimer: 'Stima pedaggi non disponibile (timeout).',
      breakdown: [],
      vignettes: [],
    }
  )

  const [stRes, toll] = await Promise.all([stationsP, tollP])
  return { consumption, stations: stRes.stations, stationError: stRes.stationError, toll }
}

function buildOption(mode, routeResult, ctx, params) {
  const cfg = MODES[mode]
  const vehicle = params.vehicle
  const planning = planCharging(routeResult, ctx, vehicle, params, cfg.capSoc, mode)

  const drivingMinutes = routeResult.durationS / 60
  const chargeMinutes = planning.chargeMinutes || 0
  const restMinutes = params.restMinutes || 0 // pause di riposo/pranzo scelte dall'utente
  const totalMinutes = drivingMinutes + chargeMinutes + restMinutes

  // Costo energia: ricariche pubbliche + quota domestica iniziale.
  const publicEnergy = planning.chargeEnergyKwh || 0
  const homeEnergy = Math.max(0, ctx.consumption.totalKwh - publicEnergy)
  const energyCost = (planning.chargeCost || 0) + homeEnergy * HOME_PRICE

  const tollCost = ctx.toll.total || 0
  const vignetteCost = ctx.toll.vignetteTotal || 0
  const totalCost = energyCost + tollCost + vignetteCost

  const warnings = []
  if (ctx.stationError) warnings.push(ctx.stationError)
  if (!planning.feasible) warnings.push(planning.reason)

  // Marker tappe/riposi sul grafico SoC (proiettati sul percorso). Le ricariche sono già in stops.
  const markerStops = (params.userStops || []).filter((s) => s.type === 'passaggio' || s.type === 'riposo')
  let userStops = []
  if (markerStops.length) {
    const cum = cumulativeKm(routeResult.points)
    userStops = markerStops.map((s) => {
      const near = nearestOnPath(routeResult.points, cum, s)
      return { label: s.label, type: s.type, durationMin: s.durationMin || 0, alongKm: round1(near.alongKm) }
    })
  }

  return {
    id: mode,
    label: cfg.label,
    feasible: planning.feasible,
    avoidedTolls: !!params.avoidTolls,
    avoidedHighways: !!params.avoidHighways,
    points: routeResult.points,
    distanceKm: round1(routeResult.distanceKm),
    drivingMinutes: round1(drivingMinutes),
    chargeMinutes: round1(chargeMinutes),
    restMinutes: round1(restMinutes),
    totalMinutes: round1(totalMinutes),
    stops: planning.stops,
    userStops,
    energyKwh: round2(ctx.consumption.totalKwh),
    avgWhKm: Math.round(ctx.consumption.avgWhKm),
    cost: {
      energy: round2(energyCost),
      toll: round2(tollCost),
      vignette: round2(vignetteCost),
      total: round2(totalCost),
    },
    socProfile: buildSocProfile(
      ctx.consumption.profile,
      planning.stops,
      vehicle.usableKwh,
      params.departSocPct ?? vehicle.defaultDepartSoc ?? 90
    ),
    warnings,
  }
}

/**
 * Ottimizzatore soste (greedy "guida al massimo, poi ricarica") parametrico per modalità.
 * Esportato per i test di regressione sulla percorribilità.
 */
export function planCharging(routeResult, ctx, vehicle, params, capSoc, mode) {
  const points = routeResult.points
  const profile = ctx.consumption.profile
  const totalKm = profile[profile.length - 1].alongKm
  const usable = vehicle.usableKwh

  // Clamp difensivo in [0,100] (oltre a quello del layer HTTP): evita SoC impossibili.
  const clampPct = (v, def) => Math.min(100, Math.max(0, Number.isFinite(Number(v)) ? Number(v) : def))
  const reservePct = clampPct(params.reserveSocPct, vehicle.reserveSocPct ?? 10)
  const arrivePct = clampPct(params.arriveSocPct, 10)
  const departPct = clampPct(params.departSocPct, vehicle.defaultDepartSoc ?? 90)
  const reserveKwh = (usable * reservePct) / 100
  const arriveKwh = (usable * arrivePct) / 100
  const bufferKwh = usable * 0.04
  const capKwh = (usable * capSoc) / 100

  const interpKwh = makeInterp(profile)
  const stations = ctx.stations

  // Soste di ricarica OBBLIGATORIE (scelte dall'utente): mappa ogni luogo alla colonnina più vicina.
  const forcedSet = []
  for (const cs of params.chargeStops || []) {
    let best = null
    let bestD = Infinity
    for (const s of stations) {
      const d = haversineKm(s, cs)
      if (d < bestD) {
        bestD = d
        best = s
      }
    }
    if (best && bestD <= 25) forcedSet.push({ alongKm: best.alongKm, station: best, targetSocPct: cs.targetSocPct })
  }
  forcedSet.sort((a, b) => a.alongKm - b.alongKm)

  // Soste di ricarica obbligatorie non mappabili a una colonnina vicina: fallisci chiaramente.
  if ((params.chargeStops?.length || 0) - forcedSet.length > 0) {
    return {
      feasible: false,
      reason:
        'Sosta di ricarica obbligatoria non pianificabile: nessuna colonnina compatibile trovata vicino al punto scelto (o stazioni non disponibili). Sposta la sosta o riprova.',
      stops: [],
    }
  }

  let curAlong = 0
  let curKwh = (usable * departPct) / 100
  const stops = []
  const served = new Set() // soste obbligatorie già onorate (per identità: niente off-by-one)

  for (let guard = 0; guard < 30; guard++) {
    const energyToDest = interpKwh(totalKm) - interpKwh(curAlong)
    const nextAnchor = forcedSet.find((f) => !served.has(f)) // prossima sosta obbligatoria da fare
    // Si può concludere solo se NON restano soste obbligatorie da onorare.
    if (!nextAnchor && curKwh - energyToDest >= arriveKwh - 1e-6) {
      return finalize(stops)
    }
    if (!stations || stations.length === 0) {
      const filtered = (params.networks?.length || (params.minPowerKw ?? 0) > 0)
      return {
        feasible: false,
        reason: filtered
          ? 'Nessuna colonnina trovata con i filtri attuali. ' + infeasibleReason(params)
          : 'Nessuna colonnina compatibile trovata lungo il percorso.',
        stops,
      }
    }

    let chosen
    if (nextAnchor) {
      const anchorReachable = curKwh - (interpKwh(nextAnchor.alongKm) - interpKwh(curAlong)) >= reserveKwh - 1e-9
      if (anchorReachable) {
        // La sosta obbligatoria è raggiungibile: è LEI la prossima fermata (onorata).
        chosen = nextAnchor.station
        served.add(nextAnchor)
      } else {
        // Serve una sosta intermedia PRIMA dell'anchor per avvicinarsi.
        const reachable = stations.filter(
          (s) =>
            s.alongKm > curAlong + 1 &&
            s.alongKm < nextAnchor.alongKm &&
            curKwh - (interpKwh(s.alongKm) - interpKwh(curAlong)) >= reserveKwh
        )
        if (reachable.length === 0) return { feasible: false, reason: infeasibleReason(params), stops }
        chosen = chooseStation(reachable, reachable[reachable.length - 1], mode)
      }
    } else {
      const reachable = stations.filter(
        (s) => s.alongKm > curAlong + 1 && curKwh - (interpKwh(s.alongKm) - interpKwh(curAlong)) >= reserveKwh
      )
      if (reachable.length === 0) return { feasible: false, reason: infeasibleReason(params), stops }
      chosen = chooseStation(reachable, reachable[reachable.length - 1], mode)
    }
    const chosenIsAnchor = !!(nextAnchor && chosen === nextAnchor.station)

    const energyToChosen = interpKwh(chosen.alongKm) - interpKwh(curAlong)
    const arrKwh = curKwh - energyToChosen
    const arrSoc = (arrKwh / usable) * 100

    // Quanto caricare. Strategia EFFICIENTE: carica una quantità significativa (fino a capSoc) e procedi
    // il più lontano possibile -> niente ricariche minime né soste ravvicinate ridondanti.
    // La raggiungibilità usa il 100% della batteria (capSoc è una preferenza, non un limite fisico).
    const maxKwh = usable
    const eChosenToDest = interpKwh(totalKm) - interpKwh(chosen.alongKm)
    const anchorsAfterChosen = forcedSet.filter((f) => !served.has(f) && f.alongKm > chosen.alongKm + 1e-6).length
    let targetKwh
    if (anchorsAfterChosen === 0 && maxKwh - eChosenToDest >= arriveKwh) {
      // possiamo finire da qui: è l'ULTIMA sosta, carica solo il necessario per arrivare
      targetKwh = eChosenToDest + arriveKwh
    } else {
      // servono altre soste: carica fino a capSoc per coprire più strada (meno soste)
      targetKwh = capKwh
      const canReachAtCap = stations.some((s) => {
        if (s.alongKm <= chosen.alongKm + 1) return false
        return capKwh - (interpKwh(s.alongKm) - interpKwh(chosen.alongKm)) >= reserveKwh
      })
      if (!canReachAtCap) {
        // il tratto richiede più di capSoc: carica quanto basta (fino al 100%) per la prossima colonnina
        const nextReach = stations.filter((s) => {
          if (s.alongKm <= chosen.alongKm + 1) return false
          return maxKwh - (interpKwh(s.alongKm) - interpKwh(chosen.alongKm)) >= reserveKwh
        })
        if (nextReach.length === 0) {
          return { feasible: false, reason: infeasibleReason(params), stops }
        }
        const nextFar = nextReach[nextReach.length - 1]
        targetKwh = interpKwh(nextFar.alongKm) - interpKwh(chosen.alongKm) + reserveKwh + bufferKwh
      }
    }
    targetKwh = Math.min(maxKwh, Math.max(targetKwh, arrKwh + usable * 0.03))
    let targetSoc = (targetKwh / usable) * 100
    if (targetSoc <= arrSoc + 0.5) targetSoc = Math.min(100, arrSoc + 5)

    // % di carica target scelta dall'utente per questa sosta di ricarica obbligatoria: si carica
    // ESATTAMENTE a quel valore (se non basta per il tratto, l'ottimizzatore aggiunge una sosta dopo).
    if (chosenIsAnchor && Number.isFinite(nextAnchor.targetSocPct)) {
      targetSoc = Math.min(100, Math.max(arrSoc + 1, nextAnchor.targetSocPct))
    }

    const stationKw = stationChargeKw(chosen)
    const minutes = chargeTimeMinutes(vehicle, arrSoc, targetSoc, stationKw)
    const energyAdded = (usable * (targetSoc - arrSoc)) / 100
    const price = priceForOperator(chosen.operator)

    stops.push({
      stationId: chosen.id,
      name: chosen.name,
      operator: chosen.operator,
      lat: chosen.lat,
      lng: chosen.lng,
      forced: chosenIsAnchor,
      alongKm: round1(chosen.alongKm),
      detourKm: round2(chosen.detourKm),
      powerKw: Math.round(stationKw),
      arriveSocPct: round1(arrSoc),
      departSocPct: round1(targetSoc),
      chargeMinutes: round1(minutes),
      energyAddedKwh: round2(energyAdded),
      pricePerKwh: price,
      cost: round2(energyAdded * price),
    })

    curAlong = chosen.alongKm
    curKwh = (usable * targetSoc) / 100
  }

  return { feasible: false, reason: 'Troppe soste necessarie: veicolo non adatto a questa tratta.', stops }

  function finalize(stops) {
    const chargeEnergyKwh = stops.reduce((s, x) => s + x.energyAddedKwh, 0)
    const chargeCost = stops.reduce((s, x) => s + x.cost, 0)
    const chargeMinutes = stops.reduce((s, x) => s + x.chargeMinutes, 0)
    return { feasible: true, stops, chargeEnergyKwh, chargeCost, chargeMinutes }
  }
}

function infeasibleReason(params) {
  const hints = []
  if ((params.minPowerKw ?? 0) > 0) hints.push(`riduci la potenza minima delle colonnine (ora ${params.minPowerKw} kW)`)
  if (params.networks?.length) hints.push('includi più reti di ricarica')
  hints.push('aumenta la carica di partenza')
  return `Tratta non percorribile con i filtri attuali. Prova a: ${hints.join('; ')}.`
}

function chooseStation(reachable, farthest, mode) {
  if (mode === 'fewest') return farthest
  if (mode === 'fastest') {
    const tail = reachable.filter((s) => s.alongKm >= farthest.alongKm - 30)
    return tail.reduce((a, b) => (stationChargeKw(b) > stationChargeKw(a) ? b : a), tail[0])
  }
  // cheapest: nella coda raggiungibile preferisci l'operatore più economico
  const tail = reachable.filter((s) => s.alongKm >= farthest.alongKm - 45)
  return tail.reduce((a, b) => (priceForOperator(b.operator) < priceForOperator(a.operator) ? b : a), tail[0])
}

function makeInterp(profile) {
  // interpolazione lineare di kWhFromStart in funzione di alongKm
  return (alongKm) => {
    if (alongKm <= 0) return 0
    const last = profile[profile.length - 1]
    if (alongKm >= last.alongKm) return last.kWhFromStart
    let lo = 0
    let hi = profile.length - 1
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1
      if (profile[mid].alongKm <= alongKm) lo = mid
      else hi = mid
    }
    const a = profile[lo]
    const b = profile[hi]
    const t = (alongKm - a.alongKm) / (b.alongKm - a.alongKm || 1)
    return a.kWhFromStart + t * (b.kWhFromStart - a.kWhFromStart)
  }
}

/**
 * Profilo SoC REALE lungo il viaggio: scende guidando e RISALE a ogni sosta di ricarica
 * (curva a "denti di sega"). A ogni sosta inserisce due punti: arrivo (basso) e ripartenza (alto).
 */
function buildSocProfile(consProfile, stops, usable, departPct) {
  const depart = Math.min(100, Math.max(0, Number(departPct) || 0)) // difesa: SoC partenza in [0,100]
  const interp = makeInterp(consProfile)
  const totalKm = consProfile[consProfile.length - 1].alongKm
  const sampleStep = Math.max(3, totalKm / 140)
  const sorted = [...stops].sort((a, b) => a.alongKm - b.alongKm)
  const out = []

  let segStartKm = 0
  let segStartKwh = (usable * depart) / 100

  const addSeg = (fromKm, toKm, startKwh) => {
    for (let km = fromKm; km < toKm - 1e-6; km += sampleStep) {
      const soc = ((startKwh - (interp(km) - interp(fromKm))) / usable) * 100
      out.push({ alongKm: round1(km), socPct: round1(Math.max(0, soc)) })
    }
  }

  for (const s of sorted) {
    addSeg(segStartKm, s.alongKm, segStartKwh)
    out.push({ alongKm: round1(s.alongKm), socPct: round1(s.arriveSocPct) }) // arrivo (prima di caricare)
    out.push({ alongKm: round1(s.alongKm), socPct: round1(s.departSocPct) }) // dopo la ricarica
    segStartKm = s.alongKm
    segStartKwh = (usable * s.departSocPct) / 100
  }
  addSeg(segStartKm, totalKm, segStartKwh)
  const finalSoc = ((segStartKwh - (interp(totalKm) - interp(segStartKm))) / usable) * 100
  out.push({ alongKm: round1(totalKm), socPct: round1(Math.max(0, finalSoc)) })
  return out
}

function round1(n) {
  return Math.round(n * 10) / 10
}
function round2(n) {
  return Math.round(n * 100) / 100
}
