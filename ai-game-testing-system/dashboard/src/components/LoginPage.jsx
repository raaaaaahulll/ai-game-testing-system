import { useNavigate, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth()
  const navigate = useNavigate()

  if (isAuthenticated) return <Navigate to="/" replace />

  function handleSubmit(e) {
    e.preventDefault()
    login()
    navigate('/', { replace: true })
  }

  return (
    <div className="min-h-screen bg-surfaceMuted flex items-center justify-center p-6">
      <div className="glass-card w-full max-w-md p-8 space-y-6">
        <div className="text-center">
          <h1 className="font-display font-bold text-2xl tracking-tight text-textPrimary">
            AI GAME TESTER
          </h1>
          <p className="text-sm text-textMuted mt-2">
            Reinforcement Learning agent + Bug Oracle dashboard
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="form-label block">Access</label>
          <p className="text-textMuted text-sm">
            Enter to open the dashboard. No password required for local use.
          </p>
          <button type="submit" className="btn-primary w-full">
            Enter dashboard
          </button>
        </form>
      </div>
    </div>
  )
}
