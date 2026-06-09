// Conversioni e formattazione in base alle unità scelte (settings.units).

export function fmtDistance(km, units) {
  if (km == null || !Number.isFinite(km)) return '—'
  const mi = units?.distance === 'mi'
  const v = mi ? km * 0.621371 : km
  const u = mi ? 'mi' : 'km'
  // decimali per distanze brevi, così le etichette non collassano tutte a "0" (ma 0 resta "0")
  const s = v === 0 ? '0' : v >= 10 ? Math.round(v) : v >= 1 ? v.toFixed(1) : v.toFixed(2)
  return `${s} ${u}`
}

export function distanceUnit(units) {
  return units?.distance === 'mi' ? 'mi' : 'km'
}

export function convDistance(km, units) {
  return units?.distance === 'mi' ? km * 0.621371 : km
}

export function fmtTemp(c, units) {
  if (units?.temp === 'F') return `${Math.round((c * 9) / 5 + 32)}°F`
  return `${Math.round(c)}°C`
}

export function fmtConsumption(whkm, units) {
  if (whkm == null) return '—'
  if (units?.consumption === 'mikwh') {
    // mi per kWh = 1 / (Wh/km in kWh/mi)
    const kmPerKwh = 1000 / whkm
    const miPerKwh = kmPerKwh * 0.621371
    return `${miPerKwh.toFixed(1)} mi/kWh`
  }
  return `${Math.round(whkm)} Wh/km`
}
