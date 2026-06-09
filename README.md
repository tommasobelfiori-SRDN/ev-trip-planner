# EV Trip Planner (BETA) 🔋🗺️

Pianificatore di viaggi per **auto elettriche**: trova il percorso **migliore ed economico** in
Europa, consiglia le **soste di ricarica** in base all'autonomia reale del tuo veicolo, mostra
**POI** (cibo, aree di servizio) lungo la strada e stima **pedaggi e autostrade**.

Costruito interamente su **dati e API aperti/gratuiti** (OpenStreetMap, OpenRouteService/OSRM,
Open Charge Map, Overpass). Nessun dato Apple/Google.

## Stack
- **Frontend**: React + Vite + MapLibre GL JS (tile gratuite OpenFreeMap, nessuna chiave) + Zustand + Tailwind
- **Backend**: Node.js + Fastify (gateway con cache e rate-limit) + Prisma + SQLite
- **Dati**: Nominatim (geocoding), OpenRouteService o OSRM (routing), Open Charge Map (colonnine),
  Overpass (POI), stima pedaggi interna per Paese (+ TollGuru opzionale)

## Avvio rapido
```bash
# 1. Configura le chiavi (gratuite)
cp backend/.env.example backend/.env
#    -> OCM_API_KEY: NECESSARIA per le colonnine (senza, OpenChargeMap risponde 403)
#    -> ORS_API_KEY: consigliata per "evita pedaggi/autostrade" ed elevazione (altrimenti usa OSRM)
#    -> APP_USER_AGENT: token semplice tipo "NomeApp/0.1" (Nominatim blocca UA con parentesi/email)

# 2. Installa, prepara il DB e avvia
npm install
npm --workspace backend run db:setup   # genera client, migra, seed veicoli
npm run dev                            # backend :5174 + frontend :5173
```
Apri http://localhost:5173

## Funzioni
- Inserimento veicolo EV (batteria, consumo, connettori) + libreria pre-caricata (28 modelli)
- **Editor della curva di ricarica** punto-per-punto (SoC % → kW) con grafico live
- Percorso su mappa con varianti **più veloce / più economico / meno soste**
- Ottimizzazione soste di ricarica realistica (curva di potenza, SoC di riserva, costo energia)
- **Prezzi per operatore** (CPO europei: Ionity, Tesla, Enel X Way, Fastned, Free To X…) usati
  nel calcolo del costo e nella scelta dell'opzione economica
- Toggle **evita pedaggi** / **evita autostrade**
- Stima costo totale = energia + pedaggi (+ vignette)
- POI filtrabili lungo il corridoio del percorso
- **Account utente** (registrazione/login con cookie di sessione): veicoli custom e viaggi salvati
  sono privati per ogni utente; in modalità ospite restano locali

## API principali
- `POST /api/auth/register|login|logout`, `GET /api/auth/me` — account e sessione (cookie httpOnly)
- `GET/POST/PUT/DELETE /api/vehicles[/:id]` — veicoli (PUT aggiorna anche la curva di ricarica)
- `POST /api/plan` — pianificazione con opzioni, soste, costi, POI
- `GET/POST/DELETE /api/trips[/:id]` — viaggi salvati (per utente)
- `GET /api/prices` — listino tariffe per operatore

## Pedaggi e vignette
- **Vignette** (Austria, Svizzera, Slovenia, Ungheria, Cechia, Slovacchia, Romania, Bulgaria):
  prezzi **ufficiali esatti** con tutti i tagli di validità, link d'acquisto e gestione delle
  **esenzioni per auto elettriche** (es. in Cechia le BEV sono esenti). Avviso esplicito di cosa
  comprare prima di partire.
- **Pedaggi a barriera** (Italia, Francia, Spagna, Portogallo, Grecia, Croazia): **reali** se imposti
  `TOLLGURU_API_KEY` (free tier), altrimenti **stima** su tariffa media per km (etichettata come tale).

## Reti di ricarica e app
- **Filtro reti**: puoi limitare le soste a operatori specifici (es. solo Tesla Supercharger, o un
  insieme di compagnie) dal pannello "Reti di ricarica".
- **App consigliate**: dopo la pianificazione l'app elenca le **app da installare** in base agli
  operatori delle soste del tuo viaggio, più le app di roaming/pianificazione utili in ogni viaggio.

## Limiti
- **Colonnine**: di default da **OpenStreetMap** (nessuna chiave). Imposta `OCM_API_KEY` per usare
  Open Charge Map (dati più ricchi). Il tagging OSM di connettori/potenza è a volte parziale: i valori
  mancanti vengono inferiti (DC→50 kW, AC→22 kW).
- **Mappa**: usa tile raster OpenStreetMap (nessuna chiave). In rete instabile alcuni tile possono
  tardare, ma percorso e marker si disegnano comunque.
- Le API gratuite hanno rate-limit (Nominatim 1 req/s, ORS 2000 req/giorno), mitigati con cache su SQLite.
