import { useEffect, useState } from 'react'
import type { HealthResponse } from '@hesta-codex/shared'

type ApiState = 'checking' | 'online' | 'offline'

export function App() {
  const [apiState, setApiState] = useState<ApiState>('checking')

  useEffect(() => {
    const controller = new AbortController()

    async function checkApi() {
      try {
        const response = await fetch('/api/v1/health', { signal: controller.signal })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const health = (await response.json()) as HealthResponse
        setApiState(health.status === 'ok' ? 'online' : 'offline')
      } catch {
        if (!controller.signal.aborted) setApiState('offline')
      }
    }

    void checkApi()
    return () => controller.abort()
  }, [])

  const statusLabel = {
    checking: 'Vérification de l’API…',
    online: 'API disponible',
    offline: 'API indisponible',
  }[apiState]

  return (
    <main className="page">
      <div className="content">
        <p className="eyebrow">Le Monde d’Hesta</p>
        <h1>Hesta Codex</h1>
        <p className="intro">
          Le futur référentiel du lore d’Hesta. Ce premier socle prépare une connaissance
          structurée, sourcée et réutilisable par les autres applications.
        </p>
        <p className={`api-status api-status--${apiState}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          {statusLabel}
        </p>
        <a href="https://hesta.dannytech.fr/">Retour au portail Hesta</a>
      </div>
    </main>
  )
}

