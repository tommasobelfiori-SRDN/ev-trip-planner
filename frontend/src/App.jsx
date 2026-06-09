import { useEffect } from 'react'
import { useStore } from './store.js'
import Map from './components/Map.jsx'
import PlanPanel from './components/PlanPanel.jsx'
import ResultsPanel from './components/ResultsPanel.jsx'
import VehicleEditor from './components/VehicleEditor.jsx'
import SavedTrips from './components/SavedTrips.jsx'
import Auth from './components/Auth.jsx'
import Settings from './components/Settings.jsx'

export default function App() {
  const { init, error, health, user, setShowAuth, logout, showVehicleEditor, editingVehicle, setShowSettings } = useStore()

  useEffect(() => {
    init()
  }, [])

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <aside className="w-[400px] shrink-0 h-full overflow-y-auto bg-white border-r border-slate-200 flex flex-col">
        <header className="px-4 py-3 border-b border-slate-200 sticky top-0 bg-white z-10">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-lg font-bold text-slate-800">🔋 EV Trip Planner</h1>
              <p className="text-[11px] text-slate-400">
                Percorso migliore ed economico · dati aperti (OSM / OpenChargeMap)
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => setShowSettings(true)} title="Impostazioni" className="text-slate-400 hover:text-slate-600 text-lg leading-none">
                ⚙️
              </button>
              {user ? (
                <div className="text-[11px] text-slate-500 text-right">
                  <div className="truncate max-w-[120px]" title={user.email}>{user.email}</div>
                  <button onClick={logout} className="text-brand hover:underline">Esci</button>
                </div>
              ) : (
                <button onClick={() => setShowAuth(true)} className="text-xs bg-brand/10 text-brand-dark px-2 py-1 rounded-lg hover:bg-brand/20">
                  Accedi
                </button>
              )}
            </div>
          </div>
          {health && (
            <p className="text-[10px] text-slate-400 mt-0.5">
              routing: {health.routing} · colonnine: {health.charging} · pedaggi: {health.toll}
            </p>
          )}
        </header>

        <div className="p-4 space-y-5 flex-1">
          <PlanPanel />
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg p-2">{error}</div>}
          <div className="border-t border-slate-200 pt-4">
            <ResultsPanel />
          </div>
          <SavedTrips />
        </div>

        <footer className="px-4 py-2 text-[10px] text-slate-400 border-t border-slate-200">
          © OpenStreetMap contributors · Open Charge Map · OpenRouteService. Pedaggi: stima indicativa.
        </footer>
      </aside>

      {/* Mappa */}
      <main className="relative flex-1 h-full">
        <Map />
      </main>

      {showVehicleEditor && <VehicleEditor key={editingVehicle?.id || 'new'} />}
      <Auth />
      <Settings />
    </div>
  )
}
