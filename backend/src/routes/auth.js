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

// Schema severo SOLO in registrazione (definisce i requisiti delle nuove credenziali).
const REGISTER_SCHEMA = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', minLength: 5, maxLength: 254, pattern: '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' },
      password: { type: 'string', minLength: 6, maxLength: 200 },
    },
  },
}

// Login permissivo: non deve mai respingere credenziali esistenti per un limite introdotto dopo.
// (Anti-DoS già garantito da bodyLimit e rate limit.)
const LOGIN_SCHEMA = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', minLength: 1, maxLength: 254 },
      password: { type: 'string', minLength: 1, maxLength: 1024 },
    },
  },
}

// Limite più severo sui tentativi di accesso (anti brute-force).
const AUTH_RATE = { rateLimit: { max: 10, timeWindow: '1 minute' } }

export default async function authRoutes(app) {
  app.post('/api/auth/register', { schema: REGISTER_SCHEMA, config: AUTH_RATE }, async (req, reply) => {
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

  app.post('/api/auth/login', { schema: LOGIN_SCHEMA, config: AUTH_RATE }, async (req, reply) => {
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
