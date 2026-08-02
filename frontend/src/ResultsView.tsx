import { useState } from 'react'
import type { AnalysisResult } from './types'

export function ResultsView({ result }: { result: AnalysisResult }) {
  const [copied, setCopied] = useState(false)

  const handleCopyCoverLetter = async () => {
    const text = result.cover_letter_paragraphs?.join('\n\n') ?? result.cover_letter
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="results">
      <div className="score-card">
        <div className="score-left">
          <span className="score-number">{result.match_score ?? '—'}</span>
        </div>
        <div className="score-right">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${result.match_score ?? 0}%` }}></div>
            <div className="progress-tick" style={{ left: `${result.match_score ?? 0}%` }}></div>
          </div>
          <p className="score-summary">
            Your resume matches {result.match_score ?? 0}% of the must-have requirements.
            {result.seniority_signal && ` Seniority signal: ${result.seniority_signal}`}
          </p>
        </div>
      </div>

      {result.gaps && result.gaps.length > 0 && (
        <section>
          <div className="section-eyebrow">— unresolved —</div>
          <h2>Gaps</h2>
          <div className="gap-list">
            {result.gaps.map((gap, i) => (
              <div key={i} className="gap-card">
                <span className="gap-number">{(i + 1).toString().padStart(2, '0')}</span>
                <strong>{gap.requirement}</strong>
                <p>{gap.note}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {result.bullet_rewrites && result.bullet_rewrites.length > 0 && (
        <section>
          <div className="section-eyebrow">— fig. 01 — bullet revisions —</div>
          <h2>Suggested bullet rewrites</h2>
          <div className="bullet-list">
            {result.bullet_rewrites.map((b, i) => (
              <div key={i} className="bullet-rewrite-card">
                <div className="bullet-section original">
                  <span className="bullet-label">A — original</span>
                  <p className="bullet-text">{b.original_bullet}</p>
                </div>
                <div className="bullet-section revised">
                  <span className="bullet-label">B — revised</span>
                  <p className="bullet-text">{b.rewritten_bullet}</p>
                  {b.why && <p className="bullet-why">{b.why}</p>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {(result.cover_letter_paragraphs?.length || result.cover_letter) && (
        <section>
          <div className="section-eyebrow">— draft —</div>
          <h2>Cover letter</h2>
          <div className="cover-letter-card">
            <button className="copy-button" onClick={handleCopyCoverLetter}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <div className="cover-letter-body">
              {(result.cover_letter_paragraphs ?? (result.cover_letter ? [result.cover_letter] : [])).map((para, i) => (
                <p key={i} className="cover-letter-p">{para.trim()}</p>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
