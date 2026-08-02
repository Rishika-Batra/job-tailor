import { useState, useEffect } from 'react'
import { useAuth } from './AuthContext'

const API_BASE = import.meta.env.VITE_API_BASE_URL

type GapTrend = {
  requirement: string
  count: number
  jobIds: string[]
}

type GapTrendsResponse = {
  trends: GapTrend[]
  jobCount: number
}

export default function GapTrendsPage() {
  const { token } = useAuth()
  const [data, setData] = useState<GapTrendsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchTrends = async () => {
      try {
        const res = await fetch(`${API_BASE}/gap-trends`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) {
          throw new Error('Failed to load gap trends')
        }
        const json: GapTrendsResponse = await res.json()
        setData(json)
      } catch {
        setError('Could not load your recurring gaps. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    if (token) {
      fetchTrends()
    }
  }, [token])

  if (loading) {
    return (
      <div className="page">
        <div className="status-panel">
          <div className="spinner" />
          <p>Looking across your past analyses...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="page">
        <div className="status-panel error">
          <p>{error}</p>
        </div>
      </div>
    )
  }

  const trends = data?.trends ?? []
  const jobCount = data?.jobCount ?? 0

  return (
    <div className="page">
      <h1>Recurring gaps</h1>
      <p className="subtitle">
        Patterns across your {jobCount} completed {jobCount === 1 ? 'analysis' : 'analyses'}.
      </p>

      {trends.length === 0 ? (
        <div className="status-panel">
          <p>Complete a couple more analyses to see your recurring skill gaps.</p>
        </div>
      ) : (
        <section className="results-section card">
          <div className="section-eyebrow">— across your history —</div>
          <div className="gap-list">
            {trends.map((trend, i) => (
              <div key={trend.requirement} className="gap-card">
                <div className="gap-number">{(i + 1).toString().padStart(2, '0')}</div>
                <strong>{trend.requirement}</strong>
                <p>
                  Appeared in {trend.count} of {jobCount} analyses
                  {trend.count / jobCount >= 0.5 ? ' — worth addressing directly' : ''}.
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
