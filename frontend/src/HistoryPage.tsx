import { useState, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { ResultsView } from './ResultsView';
import type { AnalysisResult } from './types';

const API_BASE = import.meta.env.VITE_API_BASE_URL;

type HistoryItem = {
  jobId: string;
  matchScore: number | null;
  completedAt: string | null;
  jdSnippet: string | null;
};

export default function HistoryPage() {
  const { token } = useAuth();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [jobResult, setJobResult] = useState<AnalysisResult | null>(null);
  const [loadingResult, setLoadingResult] = useState(false);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch(`${API_BASE}/history`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
        if (!res.ok) throw new Error('Failed to fetch history');
        const data = await res.json();
        setHistory(data.jobs || []);
      } catch (err: any) {
        setError(err.message || 'An error occurred');
      } finally {
        setLoading(false);
      }
    };
    fetchHistory();
  }, [token]);

  const handleViewJob = async (jobId: string) => {
    setSelectedJobId(jobId);
    setJobResult(null);
    setLoadingResult(true);
    
    try {
      const res = await fetch(`${API_BASE}/status/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!res.ok) throw new Error('Failed to load job result');
      const data = await res.json();
      if (data.status === 'complete' && data.result) {
        setJobResult(data.result);
      } else {
        throw new Error('Job is not complete or missing results');
      }
    } catch (err: any) {
      alert(err.message);
      setSelectedJobId(null);
    } finally {
      setLoadingResult(false);
    }
  };

  if (loading) {
    return <div className="page"><div className="status-panel"><div className="spinner" /></div></div>;
  }

  if (selectedJobId) {
    return (
      <div className="page">
        <button 
          className="start-over"
          onClick={() => setSelectedJobId(null)} 
          style={{ marginBottom: '2rem', alignSelf: 'flex-start' }}
        >
          &larr; Back to History
        </button>
        {loadingResult && <div className="status-panel"><div className="spinner" /><p>Loading result...</p></div>}
        {jobResult && <ResultsView result={jobResult} />}
      </div>
    );
  }

  return (
    <div className="page">
      <h1>Your History</h1>
      {error && <p className="error-text">{error}</p>}
      
      {history.length === 0 ? (
        <p>No jobs found.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '2rem' }}>
          {history.map((job) => (
            <div key={job.jobId} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1.5rem' }}>
              <div>
                <p style={{ margin: '0 0 0.5rem 0', fontWeight: 'bold' }}>
                  Match Score: {job.matchScore ?? '—'}
                </p>
                <p style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: '#5C5C57' }}>
                  {job.jdSnippet ? `"${job.jdSnippet}..."` : 'No snippet available'}
                </p>
                <p style={{ margin: 0, fontSize: '0.8rem', color: '#8A8A83' }}>
                  {job.completedAt ? new Date(job.completedAt).toLocaleString() : 'Unknown date'}
                </p>
              </div>
              <button onClick={() => handleViewJob(job.jobId)} style={{ padding: '0.5rem 1rem' }}>
                View Result
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
