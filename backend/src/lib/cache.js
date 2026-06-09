import { prisma } from './prisma.js'

// Cache su SQLite con TTL. Usata per ridurre le chiamate alle API esterne e rispettarne i rate-limit.
export async function cacheGet(key) {
  const row = await prisma.cache.findUnique({ where: { key } })
  if (!row) return null
  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.cache.delete({ where: { key } }).catch(() => {})
    return null
  }
  try {
    return JSON.parse(row.value)
  } catch {
    return null
  }
}

export async function cacheSet(key, value, ttlSeconds) {
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
  const data = JSON.stringify(value)
  await prisma.cache.upsert({
    where: { key },
    create: { key, value: data, expiresAt },
    update: { value: data, expiresAt },
  })
  return value
}

// Wrapper "memoize": se in cache (e valida) la restituisce, altrimenti calcola e salva.
export async function cached(key, ttlSeconds, producer) {
  const hit = await cacheGet(key)
  if (hit !== null) return hit
  const fresh = await producer()
  if (fresh !== undefined && fresh !== null) await cacheSet(key, fresh, ttlSeconds)
  return fresh
}
