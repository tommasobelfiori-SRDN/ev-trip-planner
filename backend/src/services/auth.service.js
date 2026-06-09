import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { prisma } from '../lib/prisma.js'

const SESSION_DAYS = 30
export const COOKIE_NAME = 'ev_sid'

// --- Password hashing con scrypt (built-in, niente dipendenze) ---
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64).toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password, stored) {
  const [salt, hash] = (stored || '').split(':')
  if (!salt || !hash) return false
  const h = scryptSync(password, salt, 64)
  const known = Buffer.from(hash, 'hex')
  return known.length === h.length && timingSafeEqual(known, h)
}

// --- Sessioni ---
export async function createSession(userId) {
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  await prisma.session.create({ data: { token, userId, expiresAt } })
  return { token, expiresAt }
}

export async function getUserFromToken(token) {
  if (!token) return null
  const s = await prisma.session.findUnique({ where: { token }, include: { user: true } })
  if (!s) return null
  if (s.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { token } }).catch(() => {})
    return null
  }
  return s.user
}

export async function deleteSession(token) {
  if (!token) return
  await prisma.session.delete({ where: { token } }).catch(() => {})
}

export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_DAYS * 24 * 60 * 60,
}
