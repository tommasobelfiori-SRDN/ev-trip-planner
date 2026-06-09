import './lib/env.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { prisma } from './lib/prisma.js'

const here = dirname(fileURLToPath(import.meta.url))
const vehicles = JSON.parse(readFileSync(resolve(here, '../db/seed-vehicles.json'), 'utf8'))

async function main() {
  let created = 0
  let updated = 0
  for (const v of vehicles) {
    const data = {
      name: v.name,
      batteryKwh: v.batteryKwh,
      usableKwh: v.usableKwh ?? v.batteryKwh,
      consumptionWhKm: v.consumptionWhKm,
      maxChargeKw: v.maxChargeKw,
      chargeCurve: JSON.stringify(v.chargeCurve),
      connectors: JSON.stringify(v.connectors),
      reserveSocPct: v.reserveSocPct ?? 10,
      defaultDepartSoc: v.defaultDepartSoc ?? 90,
      isCustom: false,
    }
    const existing = await prisma.vehicle.findFirst({ where: { name: v.name, isCustom: false } })
    if (existing) {
      // aggiorna specifiche e curva di ricarica (es. dati reali aggiornati)
      await prisma.vehicle.update({ where: { id: existing.id }, data })
      updated++
    } else {
      await prisma.vehicle.create({ data })
      created++
    }
  }
  console.log(`Seed completato: ${created} aggiunti, ${updated} aggiornati (${vehicles.length} nel file).`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
