import { useStore } from '../store.js'

const OPTIONS = [
  {
    key: 'distance',
    label: 'Distanza',
    choices: [
      ['km', 'Chilometri (km)'],
      ['mi', 'Miglia (mi)'],
    ],
  },
  {
    key: 'temp',
    label: 'Temperatura',
    choices: [
      ['C', 'Celsius (°C)'],
      ['F', 'Fahrenheit (°F)'],
    ],
  },
  {
    key: 'consumption',
    label: 'Consumo',
    choices: [
      ['whkm', 'Wh/km'],
      ['mikwh', 'mi/kWh'],
    ],
  },
]

export default function Settings() {
  const { showSettings, setShowSettings, settings, setUnit } = useStore()
  if (!showSettings) return null

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowSettings(false)}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-700">⚙️ Impostazioni · Unità di misura</h3>
          <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {OPTIONS.map((opt) => (
          <div key={opt.key}>
            <label className="block text-xs font-medium text-slate-500 mb-1">{opt.label}</label>
            <div className="flex gap-2">
              {opt.choices.map(([val, lbl]) => {
                const active = settings.units[opt.key] === val
                return (
                  <button
                    key={val}
                    onClick={() => setUnit(opt.key, val)}
                    className={`flex-1 rounded-lg border px-2 py-2 text-xs ${
                      active ? 'border-brand bg-brand/5 text-brand-dark font-medium' : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {lbl}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        <p className="text-[11px] text-slate-400">Le preferenze vengono salvate sul dispositivo.</p>
        <div className="flex justify-end">
          <button onClick={() => setShowSettings(false)} className="px-4 py-2 text-sm bg-brand text-white rounded-lg">
            Fatto
          </button>
        </div>
      </div>
    </div>
  )
}
