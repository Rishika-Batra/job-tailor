import { useState, useEffect, useRef } from 'react'
import { ResultsView } from './ResultsView'
import { useAuth } from './AuthContext'
import { GitHubRepoPicker } from './GitHubRepoPicker'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE_URL

type Gap = { requirement: string; note: string }
type Match = { requirement: string; evidence_from_resume: string }
type BulletRewrite = { original_bullet: string; rewritten_bullet: string; why: string }

type AnalysisResult = {
  match_score?: number
  must_have_requirements?: string[]
  nice_to_have_requirements?: string[]
  matches?: Match[]
  gaps?: Gap[]
  seniority_signal?: string
  bullet_rewrites?: BulletRewrite[]
  cover_letter?: string
}

type StatusResponse =
  | { status: 'complete'; result: AnalysisResult }
  | { status: string }

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export default function AnalyzePage() {
  const [resumeFile, setResumeFile] = useState<File | null>(null)
  const [jdText, setJdText] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { token, getFreshToken } = useAuth()

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  useEffect(() => {
    if (!jobId) return

    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/status/${jobId}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        })
        if (res.status === 404) {
          setError('Job not found.')
          stopPolling()
          return
        }
        const data: StatusResponse = await res.json()
        setStatus(data.status)

        if (data.status === 'complete' && 'result' in data) {
          setResult(data.result)
          stopPolling()
        } else if (data.status.startsWith('failed')) {
          stopPolling()
        }
      } catch {
        setError('Failed to check job status.')
        stopPolling()
      }
    }

    poll()
    pollRef.current = setInterval(poll, 3000)

    return () => stopPolling()
  }, [jobId])

  const resetForNewSubmission = () => {
    setJobId(null)
    setStatus(null)
    setResult(null)
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!resumeFile || !jdText.trim()) {
      setError('Please select a resume PDF and paste the job description.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const activeToken = await getFreshToken();
      console.log('Sending token (first 30 chars):', activeToken ? activeToken.substring(0, 30) + '...' : 'null');
      const resumeBase64 = await fileToBase64(resumeFile)
      const res = await fetch(`${API_BASE}/submit`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeToken}`
        },
        body: JSON.stringify({ resumeBase64, jdText }),
      })

      if (!res.ok) {
        throw new Error('Submission failed')
      }

      const data = await res.json()
      resetForNewSubmission()
      setJobId(data.jobId)
      setStatus('processing')
    } catch {
      setError('Something went wrong submitting your resume. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRetry = () => {
    resetForNewSubmission()
  }


  const isProcessing = jobId && status && !status.startsWith('failed') && status !== 'complete'
  const isFailed = status?.startsWith('failed')
  const isComplete = status === 'complete' && result

  return (
    <div className="page">
      <h1>Job Tailor</h1>
      <p className="subtitle">
        Upload your resume and a job description to get tailored bullet suggestions,
        a gap analysis, and a draft cover letter.
      </p>

      {!jobId && (
        <form onSubmit={handleSubmit} className="submit-form card">
          <label className="field">
            <span>Resume (PDF)</span>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <label className="field">
            <span>Job description</span>
            <textarea
              rows={10}
              value={jdText}
              onChange={(e) => setJdText(e.target.value)}
              placeholder="Paste the full job posting text here..."
            />
          </label>

          {error && <p className="error-text">{error}</p>}

          <button type="submit" disabled={submitting}>
            {submitting ? 'Submitting...' : 'Analyze my resume'}
          </button>
        </form>
      )}

      {isProcessing && (
        <div className="status-panel">
          <div className="spinner" />
          <p>Analyzing your resume against the job description...</p>
          <p className="status-detail">Status: {status}</p>
        </div>
      )}

      {isFailed && (
        <div className="status-panel error">
          <p>Something went wrong during processing ({status}).</p>
          <button onClick={handleRetry}>Try again</button>
        </div>
      )}

      {error && jobId && (
        <div className="status-panel error">
          <p>{error}</p>
          <button onClick={handleRetry}>Try again</button>
        </div>
      )}

      {isComplete && result && (
        <>
          <ResultsView result={result} />
          {jobId && <GitHubRepoPicker jobId={jobId} jdText={jdText} />}

          <button className="start-over" onClick={handleRetry}>
            Analyze another job
          </button>
        </>
      )}
    </div>
  )
}

