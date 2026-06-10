import { useMemo, useState } from 'react'
import { useStore } from '../store.js'
import { api } from '../api.js'

const CONNECTORS = ['CCS', 'Type2', 'CHAdeMO']

// Limiti accettati dal backend (devono combaciare con gli schemi di /api/vehicles).
const BOUNDS = {
  batteryKwh: [5, 300, 'Batteria'],
  usableKwh: [5, 300, 'Batteria utilizzabile'],
  consumptionWhKm: [50, 600, 'Consumo'],
  maxChargeKw: [3, 1000, 'Potenza di ricarica'],
  reserveSocPct: [0, 50, 'Riserva'],
  defaultDepartSoc: [10, 100, 'SoC di partenza'],
}

function clampNum(v, [min, max]) {
  const n = Number(v)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, n))
}

// Restituisce il primo errore di validazione (messaggio italiano), o null se tutto ok.
function validateForm(form, curve) {
  if (!form.name.trim()) return 'Inserisci un nome.'
  if (form.name.trim().length > 80) return 'Il nome può avere al massimo 80 caratteri.'
  for (const [key, [min, max, label]] of Object.entries(BOUNDS)) {
    const v = Number(key === 'usableKwh' ? form[key] || form.batteryKwh : form[key])
    if (!Number.isFinite(v) || v < min || v > max) return `${label}: inserisci un valore tra ${min} e ${max}.`
  }
  if (curve.length < 2) return 'La curva di ricarica deve avere almeno 2 punti.'
  if (curve.some((p) => !(p.kw > 0 && p.kw <= 1000))) return 'Curva: la potenza deve essere tra 1 e 1000 kW.'
  if (curve.some((p) => !(p.socPct >= 0 && p.socPct <= 100))) return 'Curva: la SoC deve essere tra 0 e 100%.'
  return null
}

function defaultCurve(maxKw) {
  const k = Number(maxKw) || 120
  return [
    { socPct: 5, kw: Math.round(k * 0.85) },
    { socPct: 20, kw: k },
    { socPct: 40, kw: Math.round(k * 0.8) },
    { socPct: 60, kw: Math.round(k * 0.6) },
    { socPct: 80, kw: Math.round(k * 0.38) },
    { socPct: 100, kw: Math.round(k * 0.12) },
  ]
}

export default function VehicleEditor() {
  const { showVehicleEditor, editingVehicle, closeVehicleEditor, reloadVehicles, setVehicle } = useStore()
  const isEdit = !!editingVehicle

  const [form, setForm] = useState(() =>
    editingVehicle
      ? {
          // clamp dei valori legacy nei limiti accettati dal backend
          name: String(editingVehicle.name || '').slice(0, 80),
          batteryKwh: clampNum(editingVehicle.batteryKwh, BOUNDS.batteryKwh),
          usableKwh: clampNum(editingVehicle.usableKwh, BOUNDS.usableKwh),
          consumptionWhKm: clampNum(editingVehicle.consumptionWhKm, BOUNDS.consumptionWhKm),
          maxChargeKw: clampNum(editingVehicle.maxChargeKw, BOUNDS.maxChargeKw),
          reserveSocPct: clampNum(editingVehicle.reserveSocPct, BOUNDS.reserveSocPct),
          defaultDepartSoc: clampNum(editingVehicle.defaultDepartSoc, BOUNDS.defaultDepartSoc),
          connectors: editingVehicle.connectors,
          chargeCurve: editingVehicle.chargeCurve,
        }
      : {
          name: '',
          batteryKwh: 60,
          usableKwh: '',
          consumptionWhKm: 170,
          maxChargeKw: 120,
          reserveSocPct: 10,
          defaultDepartSoc: 90,
          connectors: ['CCS', 'Type2'],
          chargeCurve: defaultCurve(120),
        }
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  if (!showVehicleEditor) return null

  function set(patch) {
    setForm((f) => ({ ...f, ...patch }))
  }
  function toggleConnector(c) {
    const has = form.connectors.includes(c)
    set({ connectors: has ? form.connectors.filter((x) => x !== c) : [...form.connectors, c] })
  }

  // --- gestione curva ---
  function updatePoint(i, key, value) {
    const curve = form.chargeCurve.map((p, idx) => (idx === i ? { ...p, [key]: Number(value) } : p))
    set({ chargeCurve: curve })
  }
  function removePoint(i) {
    if (form.chargeCurve.length <= 2) return
    set({ chargeCurve: form.chargeCurve.filter((_, idx) => idx !== i) })
  }
  function addPoint() {
    set({ chargeCurve: [...form.chargeCurve, { socPct: 50, kw: Math.round(Number(form.maxChargeKw) * 0.6) || 60 }] })
  }
  function regenCurve() {
    set({ chargeCurve: defaultCurve(form.maxChargeKw) })
  }

  async function save() {
    const curve = [...form.chargeCurve].map((p) => ({ socPct: Number(p.socPct), kw: Number(p.kw) }))
    const validationError = validateForm(form, curve)
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = { ...form, usableKwh: form.usableKwh || form.batteryKwh, chargeCurve: curve }
      const { vehicle } = isEdit ? await api.updateVehicle(editingVehicle.id, payload) : await api.createVehicle(payload)
      await reloadVehicles()
      setVehicle(vehicle.id)
      closeVehicleEditor()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 bg-black/40 flex items-center justify-center p-4" onClick={closeVehicleEditor}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 space-y-3 max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-700">{isEdit ? 'Modifica veicolo' : 'Nuovo veicolo'}</h3>
          <button onClick={closeVehicleEditor} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <Field label="Nome">
          <input className="inp" value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Es. La mia EV" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Batteria (kWh)"><input type="number" className="inp" value={form.batteryKwh} onChange={(e) => set({ batteryKwh: Number(e.target.value) })} /></Field>
          <Field label="Utilizzabile (kWh)"><input type="number" className="inp" value={form.usableKwh} onChange={(e) => set({ usableKwh: Number(e.target.value) })} placeholder="= batteria" /></Field>
          <Field label="Consumo (Wh/km)"><input type="number" className="inp" value={form.consumptionWhKm} onChange={(e) => set({ consumptionWhKm: Number(e.target.value) })} /></Field>
          <Field label="Ricarica max (kW)"><input type="number" className="inp" value={form.maxChargeKw} onChange={(e) => set({ maxChargeKw: Number(e.target.value) })} /></Field>
          <Field label="Riserva (%)"><input type="number" className="inp" value={form.reserveSocPct} onChange={(e) => set({ reserveSocPct: Number(e.target.value) })} /></Field>
          <Field label="SoC partenza (%)"><input type="number" className="inp" value={form.defaultDepartSoc} onChange={(e) => set({ defaultDepartSoc: Number(e.target.value) })} /></Field>
        </div>

        <Field label="Connettori">
          <div className="flex gap-3 text-sm">
            {CONNECTORS.map((c) => (
              <label key={c} className="flex items-center gap-1">
                <input type="checkbox" checked={form.connectors.includes(c)} onChange={() => toggleConnector(c)} /> {c}
              </label>
            ))}
          </div>
        </Field>

        {/* Editor curva di ricarica */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-slate-500">Curva di ricarica (SoC % → potenza kW)</label>
            <button className="text-xs text-slate-500 hover:underline" onClick={regenCurve} type="button">↺ Rigenera da picco</button>
          </div>
          <CurveChart curve={form.chargeCurve} maxKw={Number(form.maxChargeKw) || 120} />
          <div className="mt-2 space-y-1">
            {form.chargeCurve.map((p, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-[11px] text-slate-400 w-10">SoC</span>
                <input type="number" className="inp !py-1 w-20" value={p.socPct} min={0} max={100} onChange={(e) => updatePoint(i, 'socPct', e.target.value)} />
                <span className="text-[11px] text-slate-400">%</span>
                <span className="text-[11px] text-slate-400 w-8 text-right">kW</span>
                <input type="number" className="inp !py-1 w-20" value={p.kw} min={1} onChange={(e) => updatePoint(i, 'kw', e.target.value)} />
                <button type="button" onClick={() => removePoint(i)} className="text-slate-300 hover:text-red-500 disabled:opacity-30" disabled={form.chargeCurve.length <= 2}>✕</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addPoint} className="mt-1 text-xs text-brand hover:underline">+ Aggiungi punto</button>
        </div>

        {error && <div className="text-xs text-red-600">{error}</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={closeVehicleEditor} className="px-3 py-2 text-sm text-slate-500">Annulla</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-brand text-white rounded-lg disabled:opacity-50">
            {saving ? 'Salvataggio…' : isEdit ? 'Salva modifiche' : 'Salva veicolo'}
          </button>
        </div>
      </div>

      <style>{`.inp{width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:6px 10px;font-size:14px}`}</style>
    </div>
  )
}

function CurveChart({ curve, maxKw }) {
  const W = 460
  const H = 110
  const sorted = useMemo(() => [...curve].map((p) => ({ socPct: Number(p.socPct), kw: Number(p.kw) })).sort((a, b) => a.socPct - b.socPct), [curve])
  const yMax = Math.max(maxKw, ...sorted.map((p) => p.kw || 0), 1)
  const x = (soc) => (soc / 100) * W
  const y = (kw) => H - (kw / yMax) * H
  const d = sorted.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.socPct).toFixed(1)},${y(p.kw).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full border border-slate-200 rounded-lg bg-white">
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={0} y1={H * f} x2={W} y2={H * f} stroke="#f1f5f9" strokeWidth="1" />
      ))}
      <path d={d} fill="none" stroke="#16a34a" strokeWidth="2" />
      {sorted.map((p, i) => (
        <circle key={i} cx={x(p.socPct)} cy={y(p.kw)} r="3" fill="#16a34a" />
      ))}
      <text x="2" y="10" fontSize="9" fill="#94a3b8">{Math.round(yMax)} kW</text>
      <text x={W - 30} y={H - 3} fontSize="9" fill="#94a3b8">100%</text>
    </svg>
  )
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-500 mb-1">{label}</label>
      {children}
    </div>
  )
}
