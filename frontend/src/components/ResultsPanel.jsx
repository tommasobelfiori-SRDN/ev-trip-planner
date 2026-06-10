import { useState, useRef } from 'react'
import { useStore } from '../store.js'
import { fmtDistance, fmtConsumption } from '../units.js'
import { exportTripPdf } from '../exportPdf.js'
import { buildTimelineRows } from '../timeline.js'

export default function ResultsPanel() {
  const { planResult, selectedOptionId, setSelectedOption, poiFilter, togglePoi, saveCurrentTrip, pois, poisLoading, settings, prefs } =
    useStore()
  const units = settings.units
  const departureTime = prefs.departureTime
  const [shareCopied, setShareCopied] = useState(false)
  if (!planResult) {
    return (
      <div className="text-sm text-slate-400 p-4">
        Imposta partenza, arrivo e veicolo, poi premi <b>Pianifica viaggio</b>.
      </div>
    )
  }

  const option = planResult.options.find((o) => o.id === selectedOptionId) || planResult.options[0]

  return (
    <div className="space-y-4">
      {/* Schede opzione */}
      <div className="grid grid-cols-3 gap-2">
        {planResult.options.map((o) => (
          <button
            key={o.id}
            onClick={() => setSelectedOption(o.id)}
            className={`rounded-lg border p-2 text-left text-xs transition ${
              o.id === option.id ? 'border-brand bg-brand/5 ring-1 ring-brand' : 'border-slate-200 hover:border-slate-300'
            } ${!o.feasible ? 'opacity-60' : ''}`}
          >
            <div className="font-semibold text-slate-700">{o.label}</div>
            <div className="text-slate-500">{fmtTime(o.totalMinutes)}</div>
            <div className="text-brand-dark font-medium">€{o.cost.total.toFixed(2)}</div>
            <div className="text-[10px] text-slate-400">{o.stops.length} soste</div>
          </button>
        ))}
      </div>

      {!option.feasible && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg p-2">
          ⚠️ {option.warnings.join(' ') || 'Opzione non percorribile con il veicolo selezionato.'}
        </div>
      )}

      {/* Condizioni usate nel calcolo */}
      <div className="flex flex-wrap gap-1.5 text-[11px]">
        {planResult.weather && (
          <span className="bg-sky-50 text-sky-700 border border-sky-200 rounded-full px-2 py-0.5">
            🌡 {planResult.weather.tempC}°C meteo reale
          </span>
        )}
        {planResult.elevation && (
          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full px-2 py-0.5">
            ⛰ salite/discese incluse
          </span>
        )}
        {planResult.stations?.length > 0 && (
          <span className="bg-teal-50 text-teal-700 border border-teal-200 rounded-full px-2 py-0.5">
            🔌 {planResult.stations.length} colonnine sul percorso
          </span>
        )}
      </div>

      {/* Riepilogo */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <Stat label="Distanza" value={fmtDistance(option.distanceKm, units)} />
        <Stat label="Tempo totale" value={fmtTime(option.totalMinutes)} />
        <Stat label="Guida" value={fmtTime(option.drivingMinutes)} />
        <Stat label="Ricarica" value={fmtTime(option.chargeMinutes)} />
        {option.restMinutes > 0 && <Stat label="Riposo" value={fmtTime(option.restMinutes)} />}
        <Stat label="Energia" value={`${option.energyKwh} kWh (${fmtConsumption(option.avgWhKm, units)})`} />
        <Stat label="Soste" value={`${option.stops.length}`} />
        <Stat label="CO₂ risparmiata" value={`~${co2SavedKg(option)} kg`} />
      </div>

      {/* Itinerario con orari */}
      <Timeline option={option} departureTime={departureTime} units={units} />

      {/* Costi */}
      <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-sm">
        <div className="flex justify-between"><span className="text-slate-500">Energia</span><span>€{option.cost.energy.toFixed(2)}</span></div>
        <div className="flex justify-between">
          <span className="text-slate-500">
            Pedaggi {option.avoidedTolls ? '(evitati)' : planResult.toll?.method === 'tollguru' ? '(reali)' : '(stima)'}
          </span>
          <span>€{option.cost.toll.toFixed(2)}</span>
        </div>
        {option.cost.vignette > 0 && (
          <div className="flex justify-between"><span className="text-slate-500">Vignette</span><span>€{option.cost.vignette.toFixed(2)}</span></div>
        )}
        <div className="flex justify-between font-semibold border-t border-slate-200 mt-1 pt-1"><span>Totale</span><span className="text-brand-dark">€{option.cost.total.toFixed(2)}</span></div>
      </div>

      {/* Avviso VIGNETTE da acquistare */}
      {planResult.toll?.vignettes?.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs space-y-2">
          <div className="font-semibold text-amber-800">🛂 Vignette necessarie per questo viaggio</div>
          {planResult.toll.vignettes.map((v) => (
            <div key={v.country} className="border-t border-amber-200 pt-1 first:border-0 first:pt-0">
              <div className="font-medium text-amber-900">
                {v.name}
                {v.exemptEv ? (
                  <span className="text-green-700"> — auto elettrica ESENTE ✓</span>
                ) : (
                  <span> — da €{v.cheapest.eur.toFixed(2)} ({v.cheapest.period})</span>
                )}
              </div>
              {!v.exemptEv && (
                <div className="text-amber-700">
                  Tagli: {v.prices.map((p) => `${p.period} €${p.eur}`).join(' · ')}
                </div>
              )}
              {v.note && <div className="text-amber-600/80 text-[11px] mt-0.5">{v.note}</div>}
              <a href={v.purchaseUrl} target="_blank" rel="noreferrer" className="text-amber-800 underline">
                Acquista la vignetta {v.name} →
              </a>
            </div>
          ))}
        </div>
      )}

      {/* Profilo SoC */}
      {option.socProfile?.length > 1 && (
        <SocChart profile={option.socProfile} stops={option.stops} userStops={option.userStops} units={units} />
      )}

      {/* Soste */}
      {option.stops.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">Soste di ricarica</h4>
          <ol className="space-y-1">
            {option.stops.map((s, i) => (
              <li key={i} className="text-xs flex items-start gap-2 border border-slate-200 rounded-lg p-2">
                <span className="bg-brand text-white rounded-full w-5 h-5 flex items-center justify-center font-bold shrink-0">{i + 1}</span>
                <div>
                  <div className="font-medium text-slate-700">
                    {s.name}
                    {s.forced && <span className="ml-1 text-[10px] bg-teal-100 text-teal-700 rounded px-1">sosta richiesta</span>}
                  </div>
                  <div className="text-slate-500">
                    {s.operator || 'operatore n/d'} · ⚡{s.powerKw} kW · {fmtDistance(s.alongKm, units)}
                  </div>
                  <div className="text-slate-500">
                    {s.arriveSocPct}% → {s.departSocPct}% · ⏱{fmtTime(s.chargeMinutes)} · +{s.energyAddedKwh} kWh · €{s.cost.toFixed(2)} (€{s.pricePerKwh}/kWh)
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Pedaggi dettaglio */}
      {planResult.toll?.breakdown?.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-500 font-semibold uppercase tracking-wide">
            Pedaggi {planResult.toll.method === 'tollguru' ? '(reali)' : '(stima)'} — €{planResult.toll.total.toFixed(2)}
          </summary>
          <ul className="mt-1 space-y-0.5">
            {planResult.toll.breakdown
              .filter((b) => b.model !== 'free')
              .map((b, i) => (
                <li key={i} className="flex justify-between">
                  <span>{b.name} {b.model === 'perKm' ? `(${b.km} km)` : ''}</span>
                  <span>€{(b.cost || 0).toFixed(2)}</span>
                </li>
              ))}
          </ul>
          <p className="text-[10px] text-slate-400 mt-1">{planResult.toll.disclaimer}</p>
        </details>
      )}

      {/* App di ricarica da installare */}
      {(planResult.chargingApps?.apps?.length > 0 || planResult.chargingApps?.roaming?.length > 0) && (
        <div className="rounded-lg border border-slate-200 p-3 text-xs">
          <h4 className="text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">📱 App da installare per questo viaggio</h4>
          {planResult.chargingApps.apps.length > 0 ? (
            <ul className="space-y-0.5">
              {planResult.chargingApps.apps.map((a) => (
                <li key={a.appName} className="flex items-start gap-1">
                  <span className="text-brand-dark">●</span>
                  <span><b>{a.appName}</b> <span className="text-slate-400">— {a.operator}</span></span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-400">Nessuna app specifica per gli operatori delle soste.</p>
          )}
          {planResult.chargingApps.roaming?.length > 0 && (
            <>
              <div className="text-[11px] text-slate-400 mt-2 mb-0.5">Utili in ogni viaggio (roaming / pianificazione):</div>
              <div className="text-slate-600">{planResult.chargingApps.roaming.map((r) => r.appName).join(' · ')}</div>
            </>
          )}
        </div>
      )}

      {/* Filtro POI */}
      <div>
        <h4 className="text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">
          POI sulla mappa{' '}
          {poisLoading ? (
            <span className="text-slate-400 normal-case font-normal">· caricamento…</span>
          ) : pois?.length ? (
            <span className="text-slate-400 normal-case font-normal">· {pois.length} trovati</span>
          ) : null}
        </h4>
        <div className="flex gap-3 text-xs">
          {[['food', '🍽 Cibo'], ['services', '🅿️ Aree servizio']].map(([k, lbl]) => (
            <label key={k} className="flex items-center gap-1">
              <input type="checkbox" checked={poiFilter[k]} onChange={() => togglePoi(k)} /> {lbl}
            </label>
          ))}
        </div>
      </div>

      {planResult.warnings?.length > 0 && (
        <div className="text-[11px] text-slate-400 space-y-0.5">
          {planResult.warnings.map((w, i) => (
            <div key={i}>ℹ️ {w}</div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button onClick={saveCurrentTrip} className="flex-1 border border-brand text-brand hover:bg-brand/5 rounded-lg py-2 text-sm font-medium">
          💾 Salva
        </button>
        <button
          onClick={async () => {
            const url = useStore.getState().shareUrl()
            if (!url) return
            try {
              await navigator.clipboard.writeText(url)
              setShareCopied(true)
              setTimeout(() => setShareCopied(false), 2000)
            } catch {
              prompt('Copia il link del viaggio:', url)
            }
          }}
          className="flex-1 border border-brand text-brand hover:bg-brand/5 rounded-lg py-2 text-sm font-medium"
        >
          {shareCopied ? '✓ Copiato!' : '🔗 Condividi'}
        </button>
        <button
          onClick={() =>
            exportTripPdf({
              planResult,
              option,
              vehicleName: planResult.vehicle?.name,
              units,
              timeline: buildTimelineRows(option, departureTime, units),
            })
          }
          className="flex-1 bg-brand hover:bg-brand-dark text-white rounded-lg py-2 text-sm font-medium"
        >
          📄 PDF
        </button>
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg border border-slate-200 p-2">
      <div className="text-[10px] uppercase text-slate-400">{label}</div>
      <div className="font-medium text-slate-700">{value}</div>
    </div>
  )
}

function SocChartSvg({ profile, stops, userStops = [], units, big }) {
  const ref = useRef(null)
  const [hover, setHover] = useState(null)
  const W = big ? 760 : 360
  const H = big ? 360 : 150
  const pad = { l: 30, r: 12, t: 12, b: 26 }
  const maxKm = profile[profile.length - 1].alongKm || 1
  const x = (km) => pad.l + (km / maxKm) * (W - pad.l - pad.r)
  const y = (soc) => pad.t + (1 - Math.max(0, Math.min(100, soc)) / 100) * (H - pad.t - pad.b)
  const line = profile.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.alongKm).toFixed(1)},${y(p.socPct).toFixed(1)}`).join(' ')
  const area = `${line} L${x(maxKm).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`
  const fs = big ? 13 : 10

  const socAt = (km) => {
    if (km <= profile[0].alongKm) return profile[0].socPct
    const last = profile[profile.length - 1]
    if (km >= last.alongKm) return last.socPct
    let lo = 0
    for (let i = 0; i < profile.length - 1; i++) {
      if (profile[i].alongKm <= km) lo = i
      else break
    }
    const a = profile[lo]
    const b = profile[lo + 1]
    const span = b.alongKm - a.alongKm
    return span <= 0 ? b.socPct : a.socPct + ((km - a.alongKm) / span) * (b.socPct - a.socPct)
  }

  const onMove = (e) => {
    const svg = ref.current
    if (!svg || !svg.getScreenCTM) return
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const m = svg.getScreenCTM()
    if (!m) return
    const p = pt.matrixTransform(m.inverse())
    const px = Math.max(pad.l, Math.min(W - pad.r, p.x))
    const km = ((px - pad.l) / (W - pad.l - pad.r)) * maxKm
    setHover({ km, soc: socAt(km) })
  }

  const hx = hover ? x(hover.km) : 0
  const hy = hover ? y(hover.soc) : 0
  const tipW = big ? 114 : 90
  const labelLeft = hx + 6 + tipW > W - pad.r // se il riquadro uscirebbe a destra, mostralo a sinistra

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full bg-white" style={{ display: 'block' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={pad.l} y1={y(v)} x2={W - pad.r} y2={y(v)} stroke="#eef2f7" strokeWidth="1" />
          <text x={pad.l - 4} y={y(v) + fs / 3} fontSize={fs} textAnchor="end" fill="#94a3b8">{v}</text>
        </g>
      ))}
      {/* riserva 10% */}
      <line x1={pad.l} y1={y(10)} x2={W - pad.r} y2={y(10)} stroke="#fca5a5" strokeDasharray="6 4" strokeWidth="1" />
      <path d={area} fill="#16a34a22" />
      <path d={line} fill="none" stroke="#16a34a" strokeWidth={big ? 2.5 : 2} strokeLinejoin="round" />

      {/* marker tappe (viola) e riposi (arancio) */}
      {userStops.map((u, i) => {
        const col = u.type === 'riposo' ? '#d97706' : '#7c3aed'
        return (
          <g key={'u' + i}>
            <line x1={x(u.alongKm)} y1={pad.t} x2={x(u.alongKm)} y2={H - pad.b} stroke={col} strokeWidth="1" strokeDasharray="3 3" opacity="0.55" />
            <circle cx={x(u.alongKm)} cy={H - pad.b} r={big ? 4 : 3} fill={col} />
          </g>
        )
      })}

      {/* soste di ricarica (verde acqua) */}
      {stops.map((s, i) => (
        <g key={i}>
          <line x1={x(s.alongKm)} y1={y(s.arriveSocPct)} x2={x(s.alongKm)} y2={y(s.departSocPct)} stroke="#0d9488" strokeWidth={big ? 3 : 2} />
          <circle cx={x(s.alongKm)} cy={y(s.departSocPct)} r={big ? 5 : 3.5} fill="#0d9488" />
          <text x={x(s.alongKm)} y={y(s.departSocPct) - (big ? 9 : 6)} fontSize={fs} textAnchor="middle" fill="#0d9488" fontWeight="bold">{i + 1}</text>
        </g>
      ))}

      {/* tooltip al passaggio del mouse */}
      {hover && (
        <g pointerEvents="none">
          <line x1={hx} y1={pad.t} x2={hx} y2={H - pad.b} stroke="#64748b" strokeWidth="1" strokeDasharray="2 2" />
          <circle cx={hx} cy={hy} r={big ? 5 : 4} fill="#16a34a" stroke="#fff" strokeWidth="1.5" />
          <g transform={`translate(${labelLeft ? hx - (big ? 120 : 96) : hx + 6}, ${pad.t + 2})`}>
            <rect width={big ? 114 : 90} height={big ? 34 : 28} rx="4" fill="#0f172a" opacity="0.85" />
            <text x="6" y={big ? 15 : 12} fontSize={fs} fill="#fff" fontWeight="bold">{Math.round(hover.soc)}%</text>
            <text x="6" y={big ? 28 : 23} fontSize={fs} fill="#cbd5e1">{fmtDistance(hover.km, units)}</text>
          </g>
        </g>
      )}

      {[0, maxKm / 2, maxKm].map((km, i) => (
        <text key={i} x={x(km)} y={H - 6} fontSize={fs} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'} fill="#94a3b8">
          {fmtDistance(km, units)}
        </text>
      ))}
    </svg>
  )
}

function SocChart({ profile, stops, userStops = [], units }) {
  const [open, setOpen] = useState(false)
  const minSoc = Math.min(...profile.map((p) => p.socPct))
  const hasWaypoint = userStops.some((u) => u.type === 'passaggio')
  const hasRest = userStops.some((u) => u.type === 'riposo')
  return (
    <div>
      <h4 className="text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wide">
        Stato di carica <span className="normal-case font-normal text-slate-400">· min {Math.round(minSoc)}% · passa il mouse · clicca per ingrandire</span>
      </h4>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full border border-slate-200 rounded-lg overflow-hidden hover:border-brand"
      >
        <SocChartSvg profile={profile} stops={stops} userStops={userStops} units={units} />
      </button>

      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-slate-700">Stato di carica lungo il viaggio</h3>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <SocChartSvg profile={profile} stops={stops} userStops={userStops} units={units} big />
            <div className="flex flex-wrap gap-4 text-xs text-slate-500 mt-3">
              <span><span className="inline-block w-3 h-1 bg-brand align-middle mr-1" />carica %</span>
              <span><span className="inline-block w-3 h-0.5 align-middle mr-1" style={{ background: '#fca5a5' }} />riserva 10%</span>
              <span><span className="inline-block w-2 h-2 rounded-full align-middle mr-1" style={{ background: '#0d9488' }} />ricarica (n°)</span>
              {hasWaypoint && <span><span className="inline-block w-2 h-2 rounded-full align-middle mr-1" style={{ background: '#7c3aed' }} />tappa</span>}
              {hasRest && <span><span className="inline-block w-2 h-2 rounded-full align-middle mr-1" style={{ background: '#d97706' }} />riposo</span>}
              <span>passa il mouse per leggere carica e distanza</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function fmtTime(min) {
  const m = Math.round(min)
  const h = Math.floor(m / 60)
  const r = m % 60
  return h > 0 ? `${h}h ${r}m` : `${r}m`
}

// CO₂ risparmiata rispetto a un'auto a benzina equivalente (~6.5 L/100km, 2.31 kg CO₂/L)
// considerando le emissioni del mix elettrico europeo (~0.25 kg CO₂/kWh).
function co2SavedKg(option) {
  const petrol = option.distanceKm * 0.065 * 2.31
  const ev = (option.energyKwh || 0) * 0.25
  return Math.max(0, Math.round(petrol - ev))
}

/** Itinerario con orari: partenza → soste (ricariche e riposi in ordine di km) → arrivo. */
function Timeline({ option, departureTime, units }) {
  const rows = buildTimelineRows(option, departureTime, units)
  if (!rows) return null

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <h4 className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Itinerario</h4>
      <ol className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className="flex items-start gap-2 text-xs">
            <span className="font-mono font-semibold text-slate-700 w-11 shrink-0">{r.time}</span>
            <span className="shrink-0">{r.icon}</span>
            <span>
              <span className="text-slate-700">{r.text}</span>
              {r.sub && <span className="text-slate-400"> — {r.sub}</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}
