import './lib/env.js'
import { env } from './lib/env.js'
import { buildApp } from './app.js'
import { prisma } from './lib/prisma.js'

const app = await buildApp()

// --- Igiene cache: elimina le righe scadute all'avvio e poi ogni 6 ore ---
async function purgeExpiredCache() {
  try {
    const { count } = await prisma.cache.deleteMany({ where: { expiresAt: { lt: new Date() } } })
    if (count > 0) app.log.info({ count }, 'cache scaduta ripulita')
  } catch (e) {
    app.log.warn({ err: e }, 'pulizia cache non riuscita')
  }
}
purgeExpiredCache()
setInterval(purgeExpiredCache, 6 * 60 * 60 * 1000).unref()

// --- Spegnimento pulito: chiudi server e connessione DB prima di uscire ---
let shuttingDown = false
async function shutdown(signal) {
  if (shuttingDown) {
    app.log.warn('secondo segnale: uscita immediata')
    process.exit(130)
  }
  shuttingDown = true
  const code = signal === 'uncaughtException' ? 1 : 0
  // rete di sicurezza: se la chiusura si blocca (connessioni appese), esci comunque
  setTimeout(() => {
    app.log.error('spegnimento forzato dopo timeout')
    process.exit(code || 1)
  }, 10000).unref()
  app.log.info({ signal }, 'spegnimento in corso…')
  try {
    await app.close()
    await prisma.$disconnect()
    process.exit(code)
  } catch (e) {
    app.log.error({ err: e }, 'errore in fase di spegnimento')
    process.exit(1)
  }
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

// --- Reti di sicurezza a livello di processo ---
process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'promise non gestita') // logga ma non uccide il server
})
process.on('uncaughtException', (err) => {
  app.log.fatal({ err }, 'eccezione non catturata: uscita')
  shutdown('uncaughtException')
})

try {
  await app.listen({ port: env.PORT, host: '0.0.0.0' })
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
