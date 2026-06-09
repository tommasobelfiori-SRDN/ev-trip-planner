// Riferimento condiviso alla mappa MapLibre, per catturarne l'immagine (es. nel PDF).
let mapInstance = null

export function setMap(map) {
  mapInstance = map
}

export function getMap() {
  return mapInstance
}

/** Cattura la mappa come JPEG dataURL ridimensionato/compresso (richiede preserveDrawingBuffer). */
export function captureMapImage() {
  try {
    const m = mapInstance
    if (!m || !m.getCanvas) return null
    m.triggerRepaint?.()
    const src = m.getCanvas()
    if (!src.width || !src.height) return null
    const scale = Math.min(1, 1000 / src.width) // riduci per un PDF leggero
    const c = document.createElement('canvas')
    c.width = Math.round(src.width * scale)
    c.height = Math.round(src.height * scale)
    const ctx = c.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, c.width, c.height)
    ctx.drawImage(src, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', 0.72)
  } catch {
    return null
  }
}
