// Utility geometriche. Convenzione interna: punto = { lat, lng }. Percorso = array di punti.

const R = 6371 // raggio terrestre km

export function toRad(d) {
  return (d * Math.PI) / 180
}

export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Distanze cumulative (km) lungo un percorso: cum[i] = distanza dall'inizio fino al punto i.
export function cumulativeKm(points) {
  const cum = [0]
  for (let i = 1; i < points.length; i++) {
    cum[i] = cum[i - 1] + haversineKm(points[i - 1], points[i])
  }
  return cum
}

export function pathLengthKm(points) {
  const cum = cumulativeKm(points)
  return cum[cum.length - 1]
}

// Interpola la posizione lungo il percorso a una distanza target (km dall'inizio).
export function pointAtDistance(points, cum, targetKm) {
  if (targetKm <= 0) return { ...points[0], distKm: 0 }
  const total = cum[cum.length - 1]
  if (targetKm >= total) return { ...points[points.length - 1], distKm: total }
  let lo = 0
  let hi = cum.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid] <= targetKm) lo = mid
    else hi = mid
  }
  const segLen = cum[hi] - cum[lo] || 1e-9
  const t = (targetKm - cum[lo]) / segLen
  return {
    lat: points[lo].lat + t * (points[hi].lat - points[lo].lat),
    lng: points[lo].lng + t * (points[hi].lng - points[lo].lng),
    distKm: targetKm,
  }
}

// Ricampiona il percorso a passo regolare (km). Utile per profilo SoC e rilevamento Paese.
export function resample(points, stepKm) {
  const cum = cumulativeKm(points)
  const total = cum[cum.length - 1]
  const out = []
  for (let d = 0; d <= total; d += stepKm) {
    out.push(pointAtDistance(points, cum, d))
  }
  if (out.length === 0 || out[out.length - 1].distKm < total) {
    out.push({ ...points[points.length - 1], distKm: total })
  }
  return out
}

// Distanza minima (km) da un punto al percorso + posizione lungo il percorso (km dall'inizio).
export function nearestOnPath(points, cum, target) {
  let best = { distKm: Infinity, alongKm: 0 }
  for (let i = 0; i < points.length; i++) {
    const d = haversineKm(points[i], target)
    if (d < best.distKm) best = { distKm: d, alongKm: cum[i] }
  }
  return best
}

// Bounding box [south, west, north, east] del percorso, con padding in km.
export function corridorBbox(points, padKm = 5) {
  let south = 90
  let west = 180
  let north = -90
  let east = -180
  for (const p of points) {
    south = Math.min(south, p.lat)
    north = Math.max(north, p.lat)
    west = Math.min(west, p.lng)
    east = Math.max(east, p.lng)
  }
  const dLat = padKm / 111
  const midLat = (south + north) / 2
  const dLng = padKm / (111 * Math.max(0.2, Math.cos(toRad(midLat))))
  return [south - dLat, west - dLng, north + dLat, east + dLng]
}

// Decodifica polyline codificata (Google/OSRM, precisione 5) -> array { lat, lng }.
export function decodePolyline(str, precision = 5) {
  let index = 0
  let lat = 0
  let lng = 0
  const factor = 10 ** precision
  const coords = []
  while (index < str.length) {
    let result = 0
    let shift = 0
    let b
    do {
      b = str.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1
    result = 0
    shift = 0
    do {
      b = str.charCodeAt(index++) - 63
      result |= (b & 0x1f) << shift
      shift += 5
    } while (b >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1
    coords.push({ lat: lat / factor, lng: lng / factor })
  }
  return coords
}
