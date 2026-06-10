import { fmtDistance } from './units.js'

function fmtMin(min) {
  const m = Math.round(min)
  const h = Math.floor(m / 60)
  const r = m % 60
  return h > 0 ? `${h}h ${r}m` : `${r}m`
}

function clockAt(base, minutes) {
  const d = new Date(base.getTime() + minutes * 60000)
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Righe dell'itinerario con orari: partenza → ricariche/pause in ordine di km → arrivo.
 * Usata sia dal pannello risultati sia dall'export PDF.
 * @returns {Array<{time, icon, text, sub}>|null}
 */
export function buildTimelineRows(option, departureTime, units) {
  const base = departureTime ? new Date(departureTime) : new Date()
  if (Number.isNaN(base.getTime())) return null
  const total = option.distanceKm || 1

  const events = [
    ...option.stops.map((s) => ({
      kind: 'ricarica',
      alongKm: s.alongKm,
      dur: s.chargeMinutes,
      label: s.name,
      extra: `${Math.round(s.arriveSocPct)}-${Math.round(s.departSocPct)}%`,
    })),
    ...(option.userStops || [])
      .filter((u) => u.type === 'riposo')
      .map((u) => ({ kind: 'riposo', alongKm: u.alongKm, dur: u.durationMin, label: u.label || 'Pausa', extra: null })),
  ].sort((a, b) => a.alongKm - b.alongKm)

  let elapsed = 0
  let prevKm = 0
  let stopTime = 0
  const rows = [{ time: clockAt(base, 0), icon: '🚗', text: 'Partenza', sub: null }]
  for (const ev of events) {
    elapsed += option.drivingMinutes * ((ev.alongKm - prevKm) / total)
    rows.push({
      time: clockAt(base, elapsed + stopTime),
      icon: ev.kind === 'ricarica' ? '⚡' : '☕',
      text: String(ev.label || '').slice(0, 38),
      sub: `${ev.kind === 'ricarica' ? 'ricarica' : 'pausa'} ${fmtMin(ev.dur)}${ev.extra ? ' · ' + ev.extra : ''} · ${fmtDistance(ev.alongKm, units)}`,
    })
    stopTime += ev.dur
    prevKm = ev.alongKm
  }
  elapsed += option.drivingMinutes * ((total - prevKm) / total)
  rows.push({ time: clockAt(base, elapsed + stopTime), icon: '🏁', text: 'Arrivo', sub: null })
  return rows
}
