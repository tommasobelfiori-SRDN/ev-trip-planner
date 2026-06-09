import { cumulativeKm } from '../lib/geo.js'

const G = 9.81
const VEHICLE_MASS_KG = 1900 // massa media indicativa (incl. occupanti)
const DRIVETRAIN_EFF = 0.9 // efficienza in trazione (salita)
const REGEN_EFF = 0.6 // recupero in frenata/discesa

/**
 * Fattore di consumo legato alla temperatura ambiente.
 * Minimo ~1.0 a 20°C; cresce al freddo (riscaldamento + batteria fredda) e leggermente al caldo.
 */
export function tempFactor(tempC = 20) {
  let f = 1
  if (tempC < 15) f += (15 - tempC) * 0.012
  if (tempC > 30) f += (tempC - 30) * 0.008
  return f
}

/**
 * Fattore di consumo legato alla velocità media del percorso (aerodinamica).
 * Il consumo "di targa" dei veicoli è ~misto; in autostrada il consumo reale è più alto.
 * Riferimento ~90 km/h => 1.0; cresce con la velocità (es. ~105 km/h ≈ +12%, ~120 km/h ≈ +24%).
 */
export function speedFactor(avgKmh) {
  if (!avgKmh || avgKmh <= 0) return 1
  // Riferimento ~80 km/h (consumo "misto") => 1.0. Cresce con la velocità (aerodinamica):
  // es. ~93 km/h ≈ +12%, ~105 km/h ≈ +22%. Limiti [0.9, 1.45].
  return Math.min(1.45, Math.max(0.9, 1 + (avgKmh - 80) * 0.009))
}

/** Potenza di ricarica (kW) interpolata dalla curva alla SoC indicata. */
export function chargePowerAt(curve, socPct) {
  if (!curve?.length) return 50
  if (socPct <= curve[0].socPct) return curve[0].kw
  if (socPct >= curve[curve.length - 1].socPct) return curve[curve.length - 1].kw
  for (let i = 1; i < curve.length; i++) {
    if (socPct <= curve[i].socPct) {
      const a = curve[i - 1]
      const b = curve[i]
      const t = (socPct - a.socPct) / (b.socPct - a.socPct || 1)
      return a.kw + t * (b.kw - a.kw)
    }
  }
  return curve[curve.length - 1].kw
}

/**
 * Tempo di ricarica (minuti) da socStart% a socEnd%, limitato dalla potenza della colonnina.
 * Integra a passi di 1% tenendo conto del calo di potenza al salire della SoC.
 */
export function chargeTimeMinutes(vehicle, socStart, socEnd, stationKw) {
  if (socEnd <= socStart) return 0
  const stepKwh = vehicle.usableKwh * 0.01
  let minutes = 0
  for (let s = socStart; s < socEnd; s += 1) {
    const mid = s + 0.5
    const power = Math.min(stationKw || Infinity, chargePowerAt(vehicle.chargeCurve, mid))
    if (power <= 0) return Infinity
    minutes += (stepKwh / power) * 60
  }
  return minutes
}

/**
 * Profilo di consumo lungo il percorso.
 * @returns {{profile:Array<{alongKm,socPct,kWhFromStart}>, totalKwh:number, avgWhKm:number}}
 */
export function estimateConsumption(points, vehicle, opts = {}) {
  const departSoc = opts.departSocPct ?? vehicle.defaultDepartSoc ?? 90
  const tempC = opts.tempC ?? 20
  const fTemp = tempFactor(tempC)
  const fSpeed = speedFactor(opts.avgKmh) // velocità autostradale -> consumo più alto
  const fBase = fTemp * fSpeed
  const hasEle = points.some((p) => typeof p.ele === 'number')

  const cum = cumulativeKm(points)
  let kWhUsed = 0
  const profile = [{ alongKm: 0, socPct: departSoc, kWhFromStart: 0 }]

  for (let i = 1; i < points.length; i++) {
    const segKm = cum[i] - cum[i - 1]
    if (segKm <= 0) continue
    let segWh = segKm * vehicle.consumptionWhKm * fBase

    if (hasEle && typeof points[i].ele === 'number' && typeof points[i - 1].ele === 'number') {
      const dEle = points[i].ele - points[i - 1].ele
      const peJ = VEHICLE_MASS_KG * G * dEle
      const eleWh = dEle > 0 ? peJ / 3600 / DRIVETRAIN_EFF : (peJ / 3600) * REGEN_EFF
      segWh += eleWh
    }
    // Evita valori negativi assurdi su forti discese.
    segWh = Math.max(segWh, segKm * vehicle.consumptionWhKm * 0.25)

    kWhUsed += segWh / 1000
    const socPct = Math.max(0, departSoc - (kWhUsed / vehicle.usableKwh) * 100)
    profile.push({ alongKm: cum[i], socPct, kWhFromStart: kWhUsed })
  }

  const totalKm = cum[cum.length - 1] || 1
  return {
    profile,
    totalKwh: kWhUsed,
    avgWhKm: (kWhUsed * 1000) / totalKm,
  }
}
