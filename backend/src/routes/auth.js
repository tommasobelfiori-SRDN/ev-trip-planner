import { prisma } from '../lib/prisma.js'
import {
  hashPassword,
  verifyPassword,
  createSession,
  deleteSession,
  COOKIE_NAME,
  cookieOptions,
} from '../services/auth.service.js'

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export default async function authRoutes(app) {
  app.post('/api/auth/register', async (req, reply) => {
    const { email, password } = req.body || {}
    if (!EMAIL_RE.test(email || '')) {
      reply.code(400)
      return { error: 'Email non valida.' }
    }
    if (!password || password.length < 6) {
      reply.code(400)
      return { error: 'La password deve avere almeno 6 caratteri.' }
    }
    const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
    if (exists) {
      reply.code(409)
      return { error: 'Email già registrata.' }
    }
    const user = await prisma.user.create({
      data: { email: email.toLowerCase(), passwordHash: hashPassword(password) },
    })
    const { token } = await createSession(user.id)
    reply.setCookie(COOKIE_NAME, token, cookieOptions)
    reply.code(201)
    return { user: { id: user.id, email: user.email } }
  })

  app.post('/api/auth/login', async (req, reply) => {
    const { email, password } = req.body || {}
    const user = await prisma.user.findUnique({ where: { email: (email || '').toLowerCase() } })
    if (!user || !verifyPassword(password || '', user.passwordHash)) {
      reply.code(401)
      return { error: 'Email o password non corretti.' }
    }
    const { token } = await createSession(user.id)
    reply.setCookie(COOKIE_NAME, token, cookieOptions)
    return { user: { id: user.id, email: user.email } }
  })

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies?.[COOKIE_NAME]
    await deleteSession(token)
    reply.clearCookie(COOKIE_NAME, { path: '/' })
    return { ok: true }
  })

  app.get('/api/auth/me', async (req) => {
    return { user: req.user ? { id: req.user.id, email: req.user.email } : null }
  })
}
