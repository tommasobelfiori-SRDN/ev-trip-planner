import { useState } from 'react'
import { useStore } from '../store.js'

export default function Auth() {
  const { showAuth, setShowAuth, login, register } = useStore()
  const [mode, setMode] = useState('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  if (!showAuth) return null

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'login') await login(email, password)
      else await register(email, password)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowAuth(false)}>
      <form className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5 space-y-3" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-700">{mode === 'login' ? 'Accedi' : 'Crea un account'}</h3>
          <button type="button" onClick={() => setShowAuth(false)} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Email</label>
          <input type="email" className="inp" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Password</label>
          <input type="password" className="inp" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
          {mode === 'register' && <p className="text-[11px] text-slate-400 mt-1">Minimo 6 caratteri.</p>}
        </div>

        {error && <div className="text-xs text-red-600">{error}</div>}

        <button type="submit" disabled={busy} className="w-full bg-brand hover:bg-brand-dark text-white font-medium rounded-lg py-2 text-sm disabled:opacity-50">
          {busy ? 'Attendere…' : mode === 'login' ? 'Accedi' : 'Registrati'}
        </button>

        <p className="text-xs text-center text-slate-500">
          {mode === 'login' ? (
            <>Non hai un account?{' '}
              <button type="button" className="text-brand hover:underline" onClick={() => { setMode('register'); setError(null) }}>Registrati</button>
            </>
          ) : (
            <>Hai già un account?{' '}
              <button type="button" className="text-brand hover:underline" onClick={() => { setMode('login'); setError(null) }}>Accedi</button>
            </>
          )}
        </p>

        <style>{`.inp{width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:8px 10px;font-size:14px}`}</style>
      </form>
    </div>
  )
}
