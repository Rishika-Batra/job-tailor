import { useState } from 'react'
import type { AnalysisResult } from './types'

export function ResultsView({ result }: { result: AnalysisResult }) {
  const [copied, setCopied] = useState(false)

  const handleCopyCoverLetter = async () => {
    if (!result.cover_letter) return
    await navigator.clipboard.writeText(result.cover_letter)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="results">
      <div className="score-badge">
        <span className="score-number">{result.match_score ?? '—'}</span>
        <span className="score-label">Match Score</span>
        {result.seniority_signal && (
          <span className="seniority">{result.seniority_signal}</span>
        )}
      </div>

      {result.gaps && result.gaps.length > 0 && (
        <section>
          <h2>Gaps</h2>
          <ul className="gap-list">
            {result.gaps.map((gap, i) => (
              <li key={i}>
                <strong>{gap.requirement}</strong>
                <p>{gap.note}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {result.bullet_rewrites && result.bullet_rewrites.length > 0 && (
        <section>
          <h2>Suggested bullet rewrites</h2>
          <div className="bullet-list">
            {result.bullet_rewrites.map((b, i) => (
              <div key={i} className="bullet-pair">
                <div className="bullet original">
                  <span className="bullet-label">Original</span>
                  <p>{b.original_bullet}</p>
                </div>
                <div className="bullet rewritten">
                  <span className="bullet-label">Suggested</span>
                  <p>{b.rewritten_bullet}</p>
                </div>
                <p className="bullet-why">{b.why}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {result.cover_letter && (
        <section>
          <h2>Cover letter</h2>
          <div className="cover-letter">
            <button className="copy-button" onClick={handleCopyCoverLetter}>
              {copied ? 'Copied!' : 'Copy to clipboard'}
            </button>
            <pre>{result.cover_letter}</pre>
          </div>
        </section>
      )}
    </div>
  )
}
