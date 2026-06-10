# 🔋 EV Trip Planner (BETA)

Pianificatore di viaggi per **auto elettriche** in Europa: trova il percorso **migliore ed
economico**, calcola le **soste di ricarica** in base all'autonomia reale del tuo veicolo, stima
**pedaggi e vignette**, mostra i **POI** lungo la strada e ti dà un **PDF** del viaggio.

Costruito interamente su **dati e API aperti/gratuiti** (OpenStreetMap, OpenRouteService/OSRM,
Open Charge Map, Overpass). Nessun dato Apple/Google, nessuna chiave obbligatoria per partire.

> Stack: **React + Vite + MapLibre GL** (frontend) · **Node.js + Fastify + Prisma/SQLite** (backend)

---

## ✨ Caratteristiche

**Pianificazione**
- Percorso su mappa con **3 opzioni**: *più veloce* · *più economico* · *meno soste*
- **Ottimizzatore di ricarica realistico**: curve di ricarica per veicolo, SoC di riserva,
  consumo che cresce con la velocità autostradale (no soste “fantasma”, no ricariche da 4%)
- **Elevazione reale** lungo il percorso (Open-Meteo, senza chiave): salite e discese nel consumo
- **Meteo automatico**: temperatura prevista lungo il percorso all'orario di partenza
- **Orario di partenza + Itinerario con orari** (partenza, ricariche, pause, arrivo)
- **Salute batteria %** (degrado) applicata ai calcoli · **CO₂ risparmiata** vs benzina
- **Tappe e soste** di tre tipi, con **riordino drag & drop**:
  - 📍 *Passaggio* — luogo da attraversare
  - ⚡ *Ricarica* — fermata obbligatoria con **% di carica target** scelta da te
  - ☕ *Riposo/pranzo* — pausa con durata, sommata al tempo totale
- Toggle **evita pedaggi** / **evita autostrade** · **condivisione viaggio via link**

**Colonnine**
- Dati colonnine da **OpenStreetMap** (senza chiave) o **Open Charge Map** (con `OCM_API_KEY`)
- **Tutte le colonnine candidate sulla mappa** (DC evidenti, AC discrete) con popup
  dettagliato (potenza, stalli, costo, orari) e pulsante **“Sosta qui”**
- **Affidabilità**: escluse colonnine private/solo-bici/dismesse; **AC vs DC realistico**
  (la ricarica AC è limitata dal caricatore di bordo ~11 kW, non dalla curva DC);
  reti rapide note (Ionity, Supercharger, …) riconosciute anche senza tag completi
- **Filtro per rete/operatore** (es. solo Tesla, o un sottoinsieme)
- Potenza minima configurabile; se mancano colonnine rapide, **include automaticamente** quelle più lente
- **Prezzi per operatore** (Ionity, Tesla, Enel X Way, Fastned, …) usati nel calcolo del costo
- **App da installare** consigliate in base agli operatori delle soste

**Costi**
- Energia (ricariche pubbliche + quota domestica) + **pedaggi** + **vignette**
- **Vignette europee** con prezzi ufficiali, validità, link d'acquisto ed **esenzioni per EV**
  (es. Cechia esente); scelta automatica del taglio in base alla durata del viaggio
- Pedaggi a barriera: stima per Paese, oppure **esatti via TollGuru** (con `TOLLGURU_API_KEY`)

**Veicoli**
- **60+ modelli** pre-caricati con **curve di ricarica reali** + editor (batteria, consumo,
  connettori, **editor curva punto-per-punto** con grafico)

**Interfaccia**
- **Grafico Stato di carica** a denti di sega, interattivo (tooltip al mouse) e ingrandibile
- **Account utente** (registrazione/login) con veicoli e viaggi salvati privati
- **Esportazione PDF** del viaggio (riepilogo, mappa, grafico, soste, vignette, app)
- **Impostazioni unità**: distanza km/mi, temperatura °C/°F, consumo Wh/km · mi/kWh

---

## 🚀 Avvio rapido

Requisiti: **Node.js ≥ 20**.

```bash
git clone https://github.com/tommasobelfiori-SRDN/ev-trip-planner.git
cd ev-trip-planner

# 1) Configura le chiavi (tutte opzionali: l'app parte anche senza)
cp backend/.env.example backend/.env

# 2) Installa, prepara il DB (genera client + schema + seed veicoli)
npm install
npm --workspace backend run db:setup

# 3) Avvia backend (:5174) + frontend (:5173)
npm run dev
```

Apri **http://localhost:5173**, inserisci partenza/arrivo, scegli il veicolo e premi
**Pianifica viaggio**.

---

## 🔑 Configurazione (`backend/.env`)

Tutte le chiavi sono **opzionali**; l'app funziona anche senza, con funzioni ridotte.

| Variabile | A cosa serve | Senza |
|---|---|---|
| `OCM_API_KEY` | Colonnine da Open Charge Map | usa **OpenStreetMap** (nessuna chiave) |
| `ORS_API_KEY` | *Evita pedaggi/autostrade* + elevazione | usa **OSRM** (senza quei filtri) |
| `TOLLGURU_API_KEY` | Pedaggi a barriera **esatti** | usa la **stima** interna per Paese |
| `APP_USER_AGENT` | User-Agent per Nominatim/Overpass | default `EVTripPlanner/0.1` |

> ⚠️ Nominatim blocca gli User-Agent con parentesi o email: usa un token semplice tipo `NomeApp/0.1`.

---

## 🗺️ Dati & API (tutti aperti)

| Funzione | Servizio | Chiave |
|---|---|---|
| Geocoding | Nominatim (OSM) | no |
| Routing | OpenRouteService **o** OSRM | ORS opzionale |
| Colonnine | OpenStreetMap (Overpass) **o** Open Charge Map | OCM opzionale |
| POI (cibo, aree servizio) | Overpass (OSM) | no |
| Elevazione + meteo | Open-Meteo | no |
| Pedaggi a barriera | stima per Paese **o** TollGuru | TollGuru opzionale |
| Vignette | prezzi ufficiali pubblicati | no |
| Tile mappa | MapLibre + OSM raster | no |

I dati sono memorizzati in cache su SQLite per rispettare i rate-limit delle API gratuite.

---

## 🧱 Struttura del progetto

```
ev-trip-planner/
├── backend/                 # Node.js + Fastify + Prisma (SQLite)
│   ├── src/
│   │   ├── server.js        # entrypoint + rotte
│   │   ├── routes/          # geocode, vehicles, plan, pois, trips, auth
│   │   ├── services/        # routing, charging, poi, toll, consumption,
│   │   │                    #   pricing, planner (ottimizzatore), auth
│   │   ├── lib/             # http (rate-limit+cache), geo, prisma, env, vehicle
│   │   └── seed.js
│   ├── db/                  # seed-vehicles.json, toll/vignette/app data
│   ├── prisma/schema.prisma
│   └── test/                # test unitari (node:test)
└── frontend/                # React + Vite + MapLibre + Zustand + Tailwind
    └── src/
        ├── components/      # Map, PlanPanel, ResultsPanel, VehicleEditor,
        │                    #   Auth, Settings, SavedTrips
        ├── store.js         # stato globale (Zustand)
        ├── units.js         # conversioni unità
        └── exportPdf.js     # generazione PDF (jsPDF)
```

---

## 🔌 API principali

- `POST /api/plan` — pianifica il viaggio (opzioni, soste, costi, profilo SoC)
- `POST /api/pois` — POI lungo il percorso (caricati a parte)
- `GET/POST/PUT/DELETE /api/vehicles[/:id]` — veicoli (PUT aggiorna anche la curva di ricarica)
- `GET/POST/DELETE /api/trips[/:id]` — viaggi salvati (per utente)
- `POST /api/auth/register|login|logout`, `GET /api/auth/me` — account (cookie di sessione)
- `GET /api/geocode?q=` · `GET /api/prices` · `GET /api/health`

---

## 🧪 Test

```bash
npm --workspace backend test
```

Coprono consumo (curve, velocità, tempi di ricarica), pedaggi/vignette (per-km, esenzioni EV) e la
**percorribilità dell'ottimizzatore** (soste obbligatorie, riserva, casi limite).

---

## ⚠️ Limiti noti

- I **pedaggi a barriera** sono una **stima** (default gratuito); per valori esatti usa `TOLLGURU_API_KEY`.
- Le **colonnine OSM** hanno tagging variabile: la potenza viene **inferita** quando manca.
- Le API gratuite hanno **rate-limit** (Nominatim 1 req/s, ORS 2000/giorno): mitigati con cache.
- L'ottimizzatore è realistico ma semplificato (non modella code o disponibilità in tempo reale).

---

## 📜 Licenza

Distribuito con licenza **MIT** — vedi [`LICENSE`](LICENSE). In breve: puoi usare, modificare e
ridistribuire liberamente, mantenendo l'avviso di copyright; il software è fornito "così com'è",
senza garanzie.

I **dati** restano dei rispettivi titolari (vedi crediti): la licenza MIT copre il codice, non i dati.

## 🙏 Crediti

Dati: **© OpenStreetMap contributors** · **Open Charge Map** · **OpenRouteService** · OSRM · Overpass.
Mappa renderizzata con **MapLibre GL**. Generazione PDF con **jsPDF**.

---

🤖 Sviluppato con [Claude Code](https://claude.com/claude-code).
