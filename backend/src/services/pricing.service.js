import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const DATA = JSON.parse(readFileSync(resolve(here, '../../db/operator-prices.json'), 'utf8'))

export const DEFAULT_PUBLIC_PRICE = DATA._meta.defaultPublicPrice ?? 0.59
export const HOME_PRICE = DATA._meta.homePrice ?? 0.25

/**
 * Prezzo €/kWh per un operatore (CPO), via matching fuzzy sul nome.
 * @param {string|null} operator
 * @returns {number}
 */
export function priceForOperator(operator) {
  if (!operator) return DEFAULT_PUBLIC_PRICE
  const o = operator.toLowerCase()
  for (const e of DATA.operators) {
    if (e.match.some((m) => o.includes(m))) return e.pricePerKwh
  }
  return DEFAULT_PUBLIC_PRICE
}

/** Nome normalizzato dell'operatore se riconosciuto, altrimenti l'originale. */
export function normalizeOperator(operator) {
  if (!operator) return null
  const o = operator.toLowerCase()
  for (const e of DATA.operators) {
    if (e.match.some((m) => o.includes(m))) return e.name
  }
  return operator
}

/** Listino completo (per UI/diagnostica). */
export function priceList() {
  return {
    defaultPublicPrice: DEFAULT_PUBLIC_PRICE,
    homePrice: HOME_PRICE,
    operators: DATA.operators.map((e) => ({ name: e.name, pricePerKwh: e.pricePerKwh })),
  }
}

/** Catalogo operatori selezionabili (per il filtro reti nella UI). */
export function operatorCatalog() {
  return DATA.operators.map((e) => ({ name: e.name }))
}

/**
 * True se l'operatore di una colonnina rientra in una delle reti selezionate.
 * Se `selected` è vuoto/nullo => nessun filtro (tutte le reti).
 */
export function stationMatchesNetworks(operatorStr, selected) {
  if (!selected || selected.length === 0) return true
  const o = (operatorStr || '').toLowerCase()
  for (const name of selected) {
    const entry = DATA.operators.find((e) => e.name === name)
    const keys = entry ? entry.match : [String(name).toLowerCase()]
    if (keys.some((k) => o.includes(k))) return true
  }
  return false
}
