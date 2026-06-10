import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Mini loader .env (niente dipendenze): popola process.env senza sovrascrivere variabili già presenti.
const here = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(here, '../../.env')

if (existsSync(envPath)) {
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

export const env = {
  PORT: Number(process.env.PORT || 5174),
  // Dietro reverse proxy: TRUST_PROXY=true (o numero di hop) per risolvere il vero IP client.
  TRUST_PROXY: process.env.TRUST_PROXY === 'true' ? true : Number(process.env.TRUST_PROXY) || false,
  DATABASE_URL: process.env.DATABASE_URL || 'file:./db/ev.sqlite',
  USER_AGENT: process.env.APP_USER_AGENT || 'EVTripPlanner/0.1',
  ORS_API_KEY: process.env.ORS_API_KEY || '',
  OCM_API_KEY: process.env.OCM_API_KEY || '',
  TOLLGURU_API_KEY: process.env.TOLLGURU_API_KEY || '',
  NOMINATIM_URL: process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',
  OVERPASS_URL: process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
  OSRM_URL: process.env.OSRM_URL || 'https://router.project-osrm.org',
  ORS_URL: process.env.ORS_URL || 'https://api.openrouteservice.org',
  OCM_URL: process.env.OCM_URL || 'https://api.openchargemap.io/v3',
}
