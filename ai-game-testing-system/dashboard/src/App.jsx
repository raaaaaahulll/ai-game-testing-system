import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import LoginPage from './components/LoginPage'
import AppLayout from './components/AppLayout'
import DashboardPage from './components/DashboardPage'
import SessionsPage from './components/SessionsPage'
import AnalyticsPage from './components/AnalyticsPage'
import PlayPage from './components/PlayPage'
import GameConfigsPage from './components/GameConfigsPage'
import TrainingPage from './components/TrainingPage'

function ProtectedRoute({ children }) {
  const { isAuthenticated } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return children
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="game-configs" element={<GameConfigsPage />} />
          <Route path="training" element={<TrainingPage />} />
          <Route path="play" element={<PlayPage />} />
          <Route path="chess" element={<Navigate to="/play?game=chess" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
