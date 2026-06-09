import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const DATA = JSON.parse(readFileSync(resolve(here, '../../db/operator-apps.json'), 'utf8'))

/** Trova l'app corrispondente a una stringa operatore di colonnina. */
function matchApp(operatorStr) {
  const o = (operatorStr || '').toLowerCase()
  if (!o) return null
  for (const app of DATA.apps) {
    if ((app.match || []).some((k) => o.includes(k))) return app
  }
  return null
}

/**
 * Dato l'insieme di operatori usati nelle soste del viaggio, restituisce le app da installare
 * + le app di roaming generiche sempre utili.
 * @param {string[]} operators
 */
export function appsForOperators(operators) {
  const byName = new Map()
  for (const op of operators || []) {
    const app = matchApp(op)
    if (app) byName.set(app.appName, { operator: app.operator, appName: app.appName, ios: app.ios, android: app.android, notes: app.notes })
  }
  return {
    apps: [...byName.values()],
    roaming: (DATA.roamingApps || []).map((r) => ({ appName: r.appName, notes: r.notes })),
  }
}
