import { useEffect, useState } from 'react'
import { useStore } from '../store.js'
import { api } from '../api.js'

export default function SavedTrips() {
  const [trips, setTrips] = useState([])
  const [open, setOpen] = useState(false)
  const setStore = useStore.setState

  async function load() {
    try {
      const { trips } = await api.trips()
      setTrips(trips)
    } catch {
      setTrips([])
    }
  }

  useEffect(() => {
    if (open) load()
  }, [open])

  async function openTrip(id) {
    const { trip } = await api.trip(id)
    setStore({
      origin: { lat: trip.originLat, lng: trip.originLng, label: trip.originLabel },
      dest: { lat: trip.destLat, lng: trip.destLng, label: trip.destLabel },
      selectedVehicleId: trip.vehicleId,
      prefs: { ...useStore.getState().prefs, ...(trip.prefs || {}) },
      planResult: trip.result || null,
      selectedOptionId: trip.result?.options?.[0]?.id || 'fastest',
      stops: [], // azzera le soste della sessione precedente (i viaggi salvati non le contengono)
      pois: [],
    })
    // ricarica i POI per il percorso del viaggio caricato
    if (trip.result?.options?.[0]) useStore.getState().loadPois(trip.result.options[0])
  }

  return (
    <div className="border-t border-slate-200 pt-3">
      <button onClick={() => setOpen(!open)} className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1">
        {open ? '▾' : '▸'} Viaggi salvati
      </button>
      {open && (
        <ul className="mt-2 space-y-1">
          {trips.length === 0 && <li className="text-xs text-slate-400">Nessun viaggio salvato.</li>}
          {trips.map((t) => (
            <li key={t.id}>
              <button onClick={() => openTrip(t.id)} className="w-full text-left text-xs border border-slate-200 rounded-lg p-2 hover:border-brand">
                <div className="font-medium text-slate-700 truncate">{shortLabel(t.originLabel)} → {shortLabel(t.destLabel)}</div>
                <div className="text-slate-400">{t.vehicle}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function shortLabel(s) {
  return (s || '').split(',')[0]
}
