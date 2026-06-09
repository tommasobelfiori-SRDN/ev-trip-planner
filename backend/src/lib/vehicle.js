import { prisma } from './prisma.js'

// Converte una riga Vehicle del DB (campi JSON come stringa) nel modello usato dalla logica.
export function parseVehicle(row) {
  if (!row) return null
  return {
    ...row,
    chargeCurve: safeParse(row.chargeCurve, []),
    connectors: safeParse(row.connectors, []),
  }
}

export async function getVehicle(id) {
  const row = await prisma.vehicle.findUnique({ where: { id } })
  return parseVehicle(row)
}

// Veicoli visibili all'utente: tutti i seed (globali) + i custom di sua proprietà
// (userId null = "ospite": vede i custom senza proprietario).
export async function listVehicles(userId = null) {
  const rows = await prisma.vehicle.findMany({
    where: { OR: [{ isCustom: false }, { userId: userId }] },
    orderBy: [{ isCustom: 'desc' }, { name: 'asc' }],
  })
  return rows.map(parseVehicle)
}

function safeParse(str, fallback) {
  try {
    return JSON.parse(str)
  } catch {
    return fallback
  }
}
