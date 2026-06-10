import { create } from 'zustand'
import { api } from './api.js'

export const MAX_STOPS = 10 // stesso tetto dello schema backend (/api/plan stops maxItems)

const DEFAULT_UNITS = { distance: 'km', temp: 'C', consumption: 'whkm' }
function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('ev-settings') || '{}')
    return { units: { ...DEFAULT_UNITS, ...(saved.units || {}) } }
  } catch {
    return { units: { ...DEFAULT_UNITS } }
  }
}

export const useStore = create((set, get) => ({
  // dati di base
  vehicles: [],
  selectedVehicleId: null,
  health: null,
  user: null,
  showAuth: false,
  operators: [], // catalogo reti di ricarica selezionabili

  // input viaggio
  origin: null, // { lat, lng, label }
  dest: null,
  // soste: [{ lat, lng, label, type:'passaggio'|'ricarica'|'riposo', durationMin }]
  stops: [],

  // impostazioni unità di misura (persistite in localStorage)
  settings: loadSettings(),
  showSettings: false,
  prefs: {
    departSocPct: 90,
    arriveSocPct: 10,
    tempC: 20,
    useWeather: true, // temperatura automatica dal meteo lungo il percorso
    departureTime: '', // ISO locale (datetime-local); vuoto = adesso
    batteryHealthPct: 100,
    avoidTolls: false,
    avoidHighways: false,
    minPowerKw: 50,
    networks: [], // reti di ricarica selezionate (vuoto = tutte)
    poiCategories: ['food', 'services'],
  },

  // risultati
  planResult: null,
  selectedOptionId: 'fastest',
  pois: [],
  poisLoading: false,
  loading: false,
  error: null,
  showVehicleEditor: false,
  editingVehicle: null,
  poiFilter: { food: true, services: true },

  // azioni
  async init(attempt = 0) {
    try {
      const [{ vehicles }, health, me, prices] = await Promise.all([
        api.vehicles(),
        api.health(),
        api.me().catch(() => ({ user: null })),
        api.prices().catch(() => ({ operators: [] })),
      ])
      set({
        vehicles,
        health,
        error: null, // recupero riuscito: pulisci l'eventuale "backend non raggiungibile"
        user: me.user,
        operators: prices.operators || [],
        selectedVehicleId: get().selectedVehicleId || vehicles[0]?.id || null,
      })
      // Viaggio condiviso via link (?trip=...): ripristina e pianifica subito.
      get().restoreFromUrl()
    } catch {
      // Backend giù (o non ancora partito): messaggio chiaro + riconnessione automatica,
      // così quando il server si avvia l'app si riprende da sola senza ricaricare.
      const MAX_RETRY = 20
      if (attempt < MAX_RETRY) {
        set({ error: '⏳ Backend non raggiungibile: riprovo automaticamente… (se non è avviato: `npm run dev` nella cartella del progetto)' })
        setTimeout(() => get().init(attempt + 1), 3000)
      } else {
        set({ error: '❌ Backend non raggiungibile. Avvialo con `npm run dev` nella cartella del progetto, poi ricarica la pagina.' })
      }
    }
  },

  // --- Condivisione viaggio via URL ---
  shareUrl() {
    const { origin, dest, stops, selectedVehicleId, prefs } = get()
    if (!origin || !dest) return null
    const data = {
      o: origin,
      d: dest,
      s: stops.filter((s) => Number.isFinite(s.lat)),
      v: selectedVehicleId,
      p: {
        departSocPct: prefs.departSocPct,
        arriveSocPct: prefs.arriveSocPct,
        minPowerKw: prefs.minPowerKw,
        batteryHealthPct: prefs.batteryHealthPct,
        avoidTolls: prefs.avoidTolls,
        avoidHighways: prefs.avoidHighways,
        networks: prefs.networks,
      },
    }
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data))))
    return `${location.origin}${location.pathname}?trip=${encoded}`
  },

  restoreFromUrl() {
    try {
      const encoded = new URLSearchParams(location.search).get('trip')
      if (!encoded) return
      const data = JSON.parse(decodeURIComponent(escape(atob(encoded))))
      if (!data?.o || !data?.d) return
      const vehicleOk = get().vehicles.some((v) => v.id === data.v)
      set({
        origin: data.o,
        dest: data.d,
        stops: Array.isArray(data.s) ? data.s.slice(0, MAX_STOPS) : [],
        selectedVehicleId: vehicleOk ? data.v : get().selectedVehicleId,
        prefs: { ...get().prefs, ...(data.p || {}) },
      })
      // pulisci l'URL (evita ri-pianificazioni a ogni reload) e pianifica
      history.replaceState(null, '', location.pathname)
      get().plan()
    } catch {
      /* link malformato: ignora */
    }
  },

  toggleNetwork: (name) => {
    const cur = get().prefs.networks
    const next = cur.includes(name) ? cur.filter((n) => n !== name) : [...cur, name]
    set({ prefs: { ...get().prefs, networks: next } })
  },
  clearNetworks: () => set({ prefs: { ...get().prefs, networks: [] } }),

  setShowAuth: (v) => set({ showAuth: v }),

  async register(email, password) {
    const { user } = await api.register(email, password)
    set({ user, showAuth: false })
    await get().reloadVehicles()
  },

  async login(email, password) {
    const { user } = await api.login(email, password)
    set({ user, showAuth: false })
    await get().reloadVehicles()
  },

  async logout() {
    await api.logout()
    // azzera anche i dati di viaggio del precedente utente (privacy + niente stato sporco)
    set({ user: null, planResult: null, origin: null, dest: null, stops: [], pois: [] })
    await get().reloadVehicles()
  },

  setOrigin: (origin) => set({ origin }),
  setDest: (dest) => set({ dest }),
  addStop: () => {
    if (get().stops.length >= MAX_STOPS) return // limite allineato allo schema del backend
    set({ stops: [...get().stops, { type: 'passaggio', durationMin: 30, targetSocPct: 80, label: '', lat: null, lng: null }] })
  },
  setStopLocation: (i, point) =>
    set({ stops: get().stops.map((s, idx) => (idx === i ? { ...s, ...point } : s)) }),
  setStopType: (i, type) => set({ stops: get().stops.map((s, idx) => (idx === i ? { ...s, type } : s)) }),
  setStopDuration: (i, durationMin) =>
    set({ stops: get().stops.map((s, idx) => (idx === i ? { ...s, durationMin } : s)) }),
  setStopTarget: (i, targetSocPct) =>
    set({ stops: get().stops.map((s, idx) => (idx === i ? { ...s, targetSocPct } : s)) }),
  removeStop: (i) => set({ stops: get().stops.filter((_, idx) => idx !== i) }),
  // Aggiunge una sosta di RICARICA da un click sulla mappa (popup colonnina).
  addChargeStopAt: (lat, lng, label) => {
    if (get().stops.length >= MAX_STOPS) return false
    set({
      stops: [...get().stops, { type: 'ricarica', durationMin: 30, targetSocPct: 80, label: label || 'Colonnina', lat, lng }],
    })
    return true
  },
  reorderStops: (from, to) => {
    const arr = [...get().stops]
    if (from < 0 || from >= arr.length || to < 0 || to >= arr.length || from === to) return
    const [moved] = arr.splice(from, 1)
    arr.splice(to, 0, moved)
    set({ stops: arr })
  },

  setShowSettings: (v) => set({ showSettings: v }),
  setUnit: (key, value) => {
    const settings = { ...get().settings, units: { ...get().settings.units, [key]: value } }
    set({ settings })
    try {
      localStorage.setItem('ev-settings', JSON.stringify(settings))
    } catch {}
  },
  setVehicle: (id) => set({ selectedVehicleId: id }),
  setPrefs: (patch) => set({ prefs: { ...get().prefs, ...patch } }),
  setSelectedOption: (id) => set({ selectedOptionId: id }),
  togglePoi: (cat) => set({ poiFilter: { ...get().poiFilter, [cat]: !get().poiFilter[cat] } }),
  openVehicleEditor: (vehicle = null) => set({ showVehicleEditor: true, editingVehicle: vehicle }),
  closeVehicleEditor: () => set({ showVehicleEditor: false, editingVehicle: null }),

  async reloadVehicles() {
    const { vehicles } = await api.vehicles()
    set({ vehicles })
  },

  async plan() {
    const { origin, dest, selectedVehicleId, prefs } = get()
    if (!origin || !dest) {
      set({ error: 'Imposta partenza e arrivo.' })
      return
    }
    if (!selectedVehicleId) {
      set({ error: 'Seleziona un veicolo.' })
      return
    }
    set({ loading: true, error: null, pois: [] })
    try {
      const result = await api.plan({
        origin,
        dest,
        stops: get().stops.filter((s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng)),
        vehicleId: selectedVehicleId,
        ...prefs,
      })
      // scegli un'opzione fattibile come default
      const firstFeasible = result.options.find((o) => o.feasible) || result.options[0]
      const optionId = firstFeasible?.id || 'fastest'
      // Il percorso e i costi sono già pronti: mostriamoli subito.
      set({ planResult: result, selectedOptionId: optionId, loading: false })
      // I POI (lenti) si caricano dopo, in background, senza bloccare la UI.
      get().loadPois(firstFeasible)
    } catch (e) {
      set({ error: e.message, loading: false })
    }
  },

  // Carica i POI per il percorso dell'opzione indicata (chiamato in background dopo plan()).
  async loadPois(option) {
    const opt = option || get().selectedOption()
    const points = opt?.points
    if (!points || points.length < 2) return
    // assottiglia il percorso per ridurre il payload (max ~800 punti): basta per il corridoio POI
    const step = Math.max(1, Math.ceil(points.length / 800))
    const thin = points.filter((_, i) => i % step === 0)
    if (thin[thin.length - 1] !== points[points.length - 1]) thin.push(points[points.length - 1])
    set({ poisLoading: true })
    try {
      const { pois } = await api.pois(thin, { categories: get().prefs.poiCategories })
      set({ pois: pois || [], poisLoading: false })
    } catch (e) {
      set({ pois: [], poisLoading: false })
    }
  },

  async saveCurrentTrip() {
    const { origin, dest, selectedVehicleId, prefs, planResult } = get()
    if (!planResult) return
    await api.saveTrip({ origin, dest, vehicleId: selectedVehicleId, prefs, result: planResult })
  },

  selectedOption() {
    const { planResult, selectedOptionId } = get()
    if (!planResult) return null
    return planResult.options.find((o) => o.id === selectedOptionId) || planResult.options[0]
  },
}))

// Aiuto per il debug/test in sviluppo: espone lo store su window.
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  window.__evStore = useStore
}
