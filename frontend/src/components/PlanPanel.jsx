import { useEffect, useRef, useState } from 'react'
import { useStore, MAX_STOPS } from '../store.js'
import { api } from '../api.js'
import { fmtTemp } from '../units.js'

function AddressInput({ label, value, onPick, placeholder }) {
  const [text, setText] = useState(value?.label || '')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const timer = useRef(null)

  // Dipende dalla LABEL, non dal riferimento dell'oggetto: così cambiare tipo/durata di una sosta
  // (che ricrea l'oggetto) non cancella l'indirizzo digitato ma non ancora selezionato.
  useEffect(() => {
    setText(value?.label || '')
  }, [value?.label])

  function onChange(e) {
    const q = e.target.value
    setText(q)
    clearTimeout(timer.current)
    if (q.trim().length < 3) {
      setResults([])
      return
    }
    timer.current = setTimeout(async () => {
      try {
        const { results } = await api.geocode(q)
        setResults(results)
        setOpen(true)
      } catch {
        setResults([])
      }
    }, 450)
  }

  return (
    <div className="relative">
      {label && <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>}
      <input
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
        value={text}
        placeholder={placeholder}
        onChange={onChange}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      />
      {open && results.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-60 overflow-auto">
          {results.map((r, i) => (
            <li
              key={i}
              className="px-3 py-2 text-xs hover:bg-brand/10 cursor-pointer border-b last:border-0"
              onMouseDown={() => {
                onPick({ lat: r.lat, lng: r.lng, label: r.label })
                setText(r.label)
                setOpen(false)
              }}
            >
              {r.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function PlanPanel() {
  const {
    vehicles,
    selectedVehicleId,
    setVehicle,
    origin,
    dest,
    setOrigin,
    setDest,
    prefs,
    setPrefs,
    plan,
    loading,
    openVehicleEditor,
    operators,
    toggleNetwork,
    clearNetworks,
    stops,
    addStop,
    setStopLocation,
    setStopType,
    setStopDuration,
    setStopTarget,
    removeStop,
    reorderStops,
    settings,
  } = useStore()

  const vehicle = vehicles.find((v) => v.id === selectedVehicleId)
  const dragIndex = useRef(null)

  return (
    <div className="space-y-4">
      <AddressInput label="Partenza" value={origin} onPick={setOrigin} placeholder="Es. Milano, Italia" />

      {stops.map((s, i) => (
        <div
          key={i}
          draggable
          onDragStart={() => (dragIndex.current = i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragIndex.current != null) reorderStops(dragIndex.current, i)
            dragIndex.current = null
          }}
          className="rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-2"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
              <span className="cursor-grab text-slate-400" title="Trascina per riordinare">⠿</span> Sosta {i + 1}
            </span>
            <button type="button" onClick={() => removeStop(i)} title="Rimuovi sosta" className="text-[11px] text-slate-400 hover:text-red-500">
              rimuovi ✕
            </button>
          </div>
          <AddressInput value={s} onPick={(p) => setStopLocation(i, p)} placeholder="Luogo della sosta" />
          <div className="flex gap-2 items-center">
            <select
              className="flex-1 border border-slate-300 rounded-lg px-2 py-1.5 text-xs bg-white"
              value={s.type}
              onChange={(e) => setStopType(i, e.target.value)}
            >
              <option value="passaggio">📍 Passaggio (luogo da attraversare)</option>
              <option value="ricarica">⚡ Ricarica (fermati a caricare qui)</option>
              <option value="riposo">☕ Riposo/pranzo (pausa)</option>
            </select>
            {s.type === 'riposo' && (
              <div className="flex items-center gap-1 text-xs">
                <input
                  type="number"
                  min={5}
                  max={240}
                  step={5}
                  value={s.durationMin}
                  onChange={(e) => setStopDuration(i, Number(e.target.value))}
                  className="w-16 border border-slate-300 rounded-lg px-2 py-1.5"
                />
                min
              </div>
            )}
            {s.type === 'ricarica' && (
              <div className="flex items-center gap-1 text-xs whitespace-nowrap">
                fino al
                <input
                  type="number"
                  min={20}
                  max={100}
                  step={5}
                  value={s.targetSocPct ?? 80}
                  onChange={(e) => setStopTarget(i, Number(e.target.value))}
                  className="w-16 border border-slate-300 rounded-lg px-2 py-1.5"
                />
                %
              </div>
            )}
          </div>
        </div>
      ))}

      {stops.length < MAX_STOPS ? (
        <button type="button" onClick={addStop} className="text-xs text-brand hover:underline -mt-1">
          + Aggiungi sosta
        </button>
      ) : (
        <p className="text-[11px] text-slate-400 -mt-1">Massimo {MAX_STOPS} soste per viaggio.</p>
      )}

      <AddressInput label="Arrivo" value={dest} onPick={setDest} placeholder="Es. Monaco di Baviera" />

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-slate-500">Veicolo</label>
          <div className="flex gap-3">
            {vehicle?.isCustom && (
              <button className="text-xs text-slate-500 hover:underline" onClick={() => openVehicleEditor(vehicle)}>
                ✎ Modifica
              </button>
            )}
            <button className="text-xs text-brand hover:underline" onClick={() => openVehicleEditor(null)}>
              + Aggiungi veicolo
            </button>
          </div>
        </div>
        <select
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
          value={selectedVehicleId || ''}
          onChange={(e) => setVehicle(e.target.value)}
        >
          {vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.isCustom ? '★ ' : ''}
              {v.name}
            </option>
          ))}
        </select>
        {vehicle && (
          <p className="text-[11px] text-slate-400 mt-1">
            {vehicle.batteryKwh} kWh · {vehicle.consumptionWhKm} Wh/km · max {vehicle.maxChargeKw} kW ·{' '}
            {vehicle.connectors.join(', ')}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Slider label={`SoC partenza ${prefs.departSocPct}%`} min={20} max={100} value={prefs.departSocPct} onChange={(v) => setPrefs({ departSocPct: v })} />
        <Slider label={`SoC arrivo min ${prefs.arriveSocPct}%`} min={5} max={50} value={prefs.arriveSocPct} onChange={(v) => setPrefs({ arriveSocPct: v })} />
        <Slider label={`Potenza min ${prefs.minPowerKw} kW`} min={0} max={250} step={10} value={prefs.minPowerKw} onChange={(v) => setPrefs({ minPowerKw: v })} />
        <Slider
          label={`Salute batteria ${prefs.batteryHealthPct}%`}
          min={50}
          max={100}
          value={prefs.batteryHealthPct}
          onChange={(v) => setPrefs({ batteryHealthPct: v })}
        />
      </div>

      {/* Partenza programmata + meteo */}
      <div className="grid grid-cols-2 gap-3 items-end">
        <div>
          <label className="block text-[11px] text-slate-500 mb-1">Partenza (per meteo e orari)</label>
          <input
            type="datetime-local"
            className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs"
            value={prefs.departureTime}
            onChange={(e) => setPrefs({ departureTime: e.target.value })}
          />
        </div>
        <div>
          <label className="flex items-center gap-2 text-xs mb-1">
            <input type="checkbox" checked={prefs.useWeather} onChange={(e) => setPrefs({ useWeather: e.target.checked })} />
            🌡 Meteo reale lungo il percorso
          </label>
          {prefs.useWeather ? (
            <p className="text-[10px] text-slate-400">Temperatura automatica (Open-Meteo)</p>
          ) : (
            <Slider label={`Temperatura ${fmtTemp(prefs.tempC, settings.units)}`} min={-10} max={40} value={prefs.tempC} onChange={(v) => setPrefs({ tempC: v })} />
          )}
        </div>
      </div>

      <NetworkSelector operators={operators} selected={prefs.networks} toggle={toggleNetwork} clear={clearNetworks} />

      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={prefs.avoidTolls} onChange={(e) => setPrefs({ avoidTolls: e.target.checked })} />
          Evita pedaggi
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={prefs.avoidHighways} onChange={(e) => setPrefs({ avoidHighways: e.target.checked })} />
          Evita autostrade
        </label>
      </div>

      <button
        className="w-full bg-brand hover:bg-brand-dark text-white font-medium rounded-lg py-2.5 text-sm disabled:opacity-50"
        onClick={plan}
        disabled={loading || !origin || !dest}
      >
        {loading ? 'Calcolo in corso…' : 'Pianifica viaggio'}
      </button>
    </div>
  )
}

function Slider({ label, min, max, step = 1, value, onChange }) {
  return (
    <div>
      <label className="block text-[11px] text-slate-500 mb-1">{label}</label>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </div>
  )
}

function NetworkSelector({ operators, selected, toggle, clear }) {
  const [open, setOpen] = useState(false)
  const label = selected.length === 0 ? 'Tutte le reti' : `${selected.length} selezionate`
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-xs font-medium text-slate-500 mb-1"
      >
        <span>Reti di ricarica · <span className="text-brand-dark">{label}</span></span>
        <span>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="border border-slate-200 rounded-lg p-2 max-h-44 overflow-auto">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-slate-400">Limita alle reti scelte (vuoto = tutte)</span>
            {selected.length > 0 && (
              <button type="button" onClick={clear} className="text-[11px] text-brand hover:underline">
                azzera
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {operators.map((o) => (
              <label key={o.name} className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={selected.includes(o.name)} onChange={() => toggle(o.name)} />
                <span className="truncate" title={o.name}>{o.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
