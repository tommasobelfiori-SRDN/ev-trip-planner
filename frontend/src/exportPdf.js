import { jsPDF } from 'jspdf'
import { fmtDistance, fmtConsumption } from './units.js'
import { captureMapImage } from './mapRef.js'

const GREEN = [22, 163, 74]
const SLATE = [100, 116, 139]
const DARK = [15, 23, 42]

function fmtTime(min) {
  const m = Math.round(min || 0)
  const h = Math.floor(m / 60)
  const r = m % 60
  return h > 0 ? `${h}h ${r}m` : `${r}m`
}
const eur = (n) => `€${(n || 0).toFixed(2)}`

/** Genera e scarica un PDF del viaggio pianificato. */
export function exportTripPdf(args) {
  const { doc, filename } = buildTripDoc(args)
  doc.save(filename)
}

/** Costruisce il documento PDF (separato dal salvataggio, per i test). */
export function buildTripDoc({ planResult, option, vehicleName, units, timeline }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210
  const H = 297
  const M = 14
  const CW = W - 2 * M
  let y = M

  const ensure = (h) => {
    if (y + h > H - M) {
      doc.addPage()
      y = M
    }
  }
  const text = (s, x, yy, opts) => doc.text(String(s), x, yy, opts)
  const sectionTitle = (t) => {
    ensure(10)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...DARK)
    text(t, M, y)
    y += 1.5
    doc.setDrawColor(...GREEN)
    doc.setLineWidth(0.4)
    doc.line(M, y, M + CW, y)
    y += 5
    doc.setFont('helvetica', 'normal')
  }

  // --- Intestazione ---
  doc.setFillColor(...GREEN)
  doc.rect(0, 0, W, 4, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.setTextColor(...DARK)
  y += 4
  text('Piano di viaggio EV', M, y)
  y += 8
  doc.setFontSize(12)
  doc.setTextColor(...GREEN)
  const route = `${planResult?.origin?.label?.split(',')[0] || 'Partenza'}  >  ${planResult?.dest?.label?.split(',')[0] || 'Arrivo'}`
  text(route, M, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...SLATE)
  const dateStr = new Date().toLocaleDateString('it-IT')
  const conditions = [
    planResult?.weather ? `meteo ${planResult.weather.tempC}°C` : null,
    planResult?.elevation ? 'salite/discese incluse' : null,
  ]
    .filter(Boolean)
    .join(' · ')
  text(
    `Veicolo: ${vehicleName || '—'}   ·   Opzione: ${option?.label || '—'}   ·   Data: ${dateStr}${conditions ? '   ·   ' + conditions : ''}`,
    M,
    y
  )
  y += 7

  // --- Riepilogo ---
  const cost = option?.cost || {}
  const stats = [
    ['Distanza', fmtDistance(option?.distanceKm, units)],
    ['Tempo totale', fmtTime(option?.totalMinutes)],
    ['Guida', fmtTime(option?.drivingMinutes)],
    ['Ricarica', fmtTime(option?.chargeMinutes)],
    ['Riposo', fmtTime(option?.restMinutes)],
    ['Energia', `${option?.energyKwh ?? '—'} kWh`],
    ['Consumo', fmtConsumption(option?.avgWhKm, units)],
    ['Soste', String(option?.stops?.length ?? 0)],
  ]
  const cols = 4
  const cellW = CW / cols
  const cellH = 13
  ensure(cellH * 2 + 2)
  stats.forEach((st, i) => {
    const cx = M + (i % cols) * cellW
    const cy = y + Math.floor(i / cols) * cellH
    doc.setDrawColor(226, 232, 240)
    doc.setLineWidth(0.2)
    doc.roundedRect(cx + 1, cy, cellW - 2, cellH - 2, 1, 1)
    doc.setFontSize(7)
    doc.setTextColor(...SLATE)
    text(st[0].toUpperCase(), cx + 3, cy + 4)
    doc.setFontSize(10)
    doc.setTextColor(...DARK)
    doc.setFont('helvetica', 'bold')
    text(st[1], cx + 3, cy + 9)
    doc.setFont('helvetica', 'normal')
  })
  y += cellH * 2 + 2

  // Costo totale evidenziato
  ensure(12)
  doc.setFillColor(240, 253, 244)
  doc.roundedRect(M, y, CW, 10, 1, 1, 'F')
  doc.setFontSize(9)
  doc.setTextColor(...SLATE)
  text(`Energia ${eur(cost.energy)}   ·   Pedaggi ${eur(cost.toll)}   ·   Vignette ${eur(cost.vignette)}`, M + 3, y + 6)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...GREEN)
  text(`Totale ${eur(cost.total)}`, M + CW - 3, y + 6.5, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  y += 14

  // --- Mappa (best-effort) ---
  const mapImg = captureMapImage()
  if (mapImg) {
    try {
      const props = doc.getImageProperties(mapImg)
      const imgW = CW
      const imgH = Math.min(80, (props.height / props.width) * imgW)
      ensure(imgH + 4)
      doc.addImage(mapImg, 'JPEG', M, y, imgW, imgH)
      doc.setDrawColor(226, 232, 240)
      doc.roundedRect(M, y, imgW, imgH, 1, 1)
      y += imgH + 6
    } catch {
      /* salta la mappa se non valida */
    }
  }

  // --- Grafico SoC ---
  if (option?.socProfile?.length > 1) {
    sectionTitle('Stato di carica')
    const chH = 38
    ensure(chH + 6)
    const x0 = M
    const y0 = y
    const plotW = CW
    const maxKm = option.socProfile[option.socProfile.length - 1].alongKm || 1
    const px = (km) => x0 + (km / maxKm) * plotW
    const py = (soc) => y0 + (1 - Math.max(0, Math.min(100, soc)) / 100) * chH
    // griglia
    doc.setDrawColor(238, 242, 247)
    doc.setLineWidth(0.2)
    ;[0, 25, 50, 75, 100].forEach((v) => {
      doc.line(x0, py(v), x0 + plotW, py(v))
      doc.setFontSize(6)
      doc.setTextColor(...SLATE)
      text(String(v), x0 - 1, py(v) + 1, { align: 'right' })
    })
    // riserva 10%
    doc.setDrawColor(252, 165, 165)
    doc.setLineDashPattern([1, 1], 0)
    doc.line(x0, py(10), x0 + plotW, py(10))
    doc.setLineDashPattern([], 0)
    // curva
    doc.setDrawColor(...GREEN)
    doc.setLineWidth(0.5)
    const p = option.socProfile
    for (let i = 1; i < p.length; i++) {
      doc.line(px(p[i - 1].alongKm), py(p[i - 1].socPct), px(p[i].alongKm), py(p[i].socPct))
    }
    // soste
    doc.setFillColor(13, 148, 136)
    ;(option.stops || []).forEach((s, i) => {
      doc.circle(px(s.alongKm), py(s.departSocPct), 0.8, 'F')
      doc.setFontSize(6)
      doc.setTextColor(13, 148, 136)
      text(String(i + 1), px(s.alongKm), py(s.departSocPct) - 1.5, { align: 'center' })
    })
    doc.setFontSize(6)
    doc.setTextColor(...SLATE)
    text(fmtDistance(0, units), x0, y0 + chH + 4)
    text(fmtDistance(maxKm, units), x0 + plotW, y0 + chH + 4, { align: 'right' })
    y += chH + 8
  }

  // --- Itinerario con orari ---
  if (Array.isArray(timeline) && timeline.length >= 2) {
    sectionTitle('Itinerario')
    const ICON_LABEL = { '🚗': 'Partenza', '⚡': 'Ricarica', '☕': 'Pausa', '🏁': 'Arrivo' }
    doc.setFontSize(9)
    for (const r of timeline) {
      ensure(6)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(...DARK)
      text(r.time, M, y)
      doc.setFont('helvetica', 'normal')
      const kindLabel = ICON_LABEL[r.icon] || ''
      const main = r.text === 'Partenza' || r.text === 'Arrivo' ? r.text : `${kindLabel}: ${r.text}`
      text(main.slice(0, 60), M + 16, y)
      if (r.sub) {
        doc.setTextColor(...SLATE)
        doc.setFontSize(8)
        text(String(r.sub).slice(0, 70), M + 16, y + 3.6)
        doc.setFontSize(9)
        doc.setTextColor(...DARK)
        y += 4
      }
      y += 5.5
    }
    y += 2
  }

  // --- Soste di ricarica ---
  const stops = option?.stops || []
  if (stops.length) {
    sectionTitle('Soste di ricarica')
    // intestazione tabella
    const colsDef = [
      { t: '#', w: 7 },
      { t: 'Colonnina', w: 52 },
      { t: 'kW', w: 14 },
      { t: 'Pos.', w: 22 },
      { t: 'SoC', w: 26 },
      { t: 'Tempo', w: 18 },
      { t: 'Costo', w: 23 },
    ]
    doc.setFontSize(8)
    doc.setTextColor(...SLATE)
    let cx = M
    colsDef.forEach((c) => {
      text(c.t, cx, y)
      cx += c.w
    })
    y += 1.5
    doc.setDrawColor(226, 232, 240)
    doc.line(M, y, M + CW, y)
    y += 4
    doc.setTextColor(...DARK)
    stops.forEach((s, i) => {
      ensure(7)
      cx = M
      const cells = [
        String(i + 1) + (s.forced ? '*' : ''),
        (s.name || '—').slice(0, 34) + (s.operator ? ` (${s.operator})`.slice(0, 18) : ''),
        `${s.powerKw}`,
        fmtDistance(s.alongKm, units),
        `${Math.round(s.arriveSocPct)}-${Math.round(s.departSocPct)}%`,
        fmtTime(s.chargeMinutes),
        eur(s.cost),
      ]
      doc.setFontSize(8)
      cells.forEach((val, ci) => {
        const wrapped = doc.splitTextToSize(String(val), colsDef[ci].w - 2)
        text(wrapped[0], cx, y)
        cx += colsDef[ci].w
      })
      y += 6
    })
    if (stops.some((s) => s.forced)) {
      doc.setFontSize(7)
      doc.setTextColor(...SLATE)
      text('* sosta di ricarica richiesta dall’utente', M, y)
      y += 5
    }
  }

  // --- Vignette da acquistare ---
  const vignettes = (planResult?.toll?.vignettes || []).filter((v) => v.required && !v.exemptEv)
  if (vignettes.length) {
    sectionTitle('Vignette da acquistare')
    doc.setFontSize(9)
    vignettes.forEach((v) => {
      ensure(7)
      doc.setTextColor(...DARK)
      doc.setFont('helvetica', 'bold')
      text(`${v.name}: ${eur(v.cheapest?.eur)} (${v.cheapest?.period || ''})`, M, y)
      doc.setFont('helvetica', 'normal')
      if (v.purchaseUrl) {
        doc.setTextColor(...GREEN)
        doc.setFontSize(8)
        text(v.purchaseUrl, M + CW, y, { align: 'right' })
        doc.setFontSize(9)
      }
      y += 6
    })
    const exempt = (planResult?.toll?.vignettes || []).filter((v) => v.exemptEv)
    if (exempt.length) {
      doc.setFontSize(8)
      doc.setTextColor(...SLATE)
      ensure(6)
      text(`Esente (auto elettrica): ${exempt.map((v) => v.name).join(', ')}`, M, y)
      y += 6
    }
  }

  // --- Caselli e barriere di riferimento ---
  const booths = planResult?.tollBooths || []
  if (booths.length) {
    sectionTitle('Caselli e barriere sul percorso')
    doc.setFontSize(8)
    const shown = booths.slice(0, 16)
    for (const b of shown) {
      ensure(5)
      doc.setTextColor(...SLATE)
      doc.setFont('helvetica', 'bold')
      text(`km ${b.alongKm}`, M, y)
      doc.setFont('helvetica', 'normal')
      doc.setTextColor(...DARK)
      text(`${b.name}${b.type === 'portale' ? '  (portale free-flow)' : ''}`.slice(0, 70), M + 20, y)
      y += 4.5
    }
    if (booths.length > shown.length) {
      doc.setTextColor(...SLATE)
      ensure(5)
      text(`… e altri ${booths.length - shown.length}`, M, y)
      y += 4.5
    }
    y += 2
  }

  // --- App da installare ---
  const apps = planResult?.chargingApps?.apps || []
  const roaming = planResult?.chargingApps?.roaming || []
  if (apps.length || roaming.length) {
    sectionTitle('App di ricarica da installare')
    doc.setFontSize(9)
    doc.setTextColor(...DARK)
    apps.forEach((a) => {
      ensure(6)
      const name = a.appName || a.operator || '—'
      text(`• ${name}${a.operator && a.operator !== name ? '  —  ' + a.operator : ''}`, M, y)
      y += 5.5
    })
    if (roaming.length) {
      ensure(6)
      doc.setFontSize(8)
      doc.setTextColor(...SLATE)
      text(`Roaming/pianificazione: ${roaming.map((r) => r.appName).join(' · ')}`, M, y)
      y += 5.5
    }
  }

  // --- Footer ---
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(...SLATE)
    doc.text(
      'Stime indicative · Dati: © OpenStreetMap contributors, Open Charge Map, OpenRouteService · EV Trip Planner',
      M,
      H - 8
    )
    doc.text(`${i}/${pages}`, W - M, H - 8, { align: 'right' })
  }

  const safe = (s) => (s || '').split(',')[0].replace(/[^\p{L}\p{N}]+/gu, '_').slice(0, 24)
  return { doc, filename: `viaggio_${safe(planResult?.origin?.label)}_${safe(planResult?.dest?.label)}.pdf` }
}
