import { useState } from 'react';
import { useAuth } from './AuthContext';

const API_BASE = import.meta.env.VITE_API_BASE_URL;

type Repo = {
  name: string;
  description: string | null;
  language: string | null;
  stars: number;
  url: string;
  updatedAt: string;
};

type Suggestion = {
  name: string;
  rank: number;
  reason: string;
};

type Props = {
  jobId: string;
  jdText?: string;
};

export function GitHubRepoPicker({ jobId, jdText }: Props) {
  const { getFreshToken } = useAuth();
  const [username, setUsername] = useState('');
  const [repos, setRepos] = useState<Repo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState<Record<string, Suggestion>>({});
  const [generatingResume, setGeneratingResume] = useState(false);
  const [resumeSuccessUrl, setResumeSuccessUrl] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);

  const handleFetch = async () => {
    if (!username.trim()) return;
    setLoading(true);
    setError(null);
    setRepos([]);
    setSelectedRepos(new Set());
    setSuggestions({});

    try {
      const activeToken = await getFreshToken();
      const res = await fetch(`${API_BASE}/github-repos?username=${encodeURIComponent(username.trim())}`, {
        headers: {
          'Authorization': `Bearer ${activeToken}`
        }
      });

      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('GitHub user not found');
        }
        throw new Error('Failed to fetch repositories');
      }

      const data = await res.json();
      const fetchedRepos = data.repos || [];
      
      // We wait for suggestions before setting everything, 
      // or we can setRepos first so they show up immediately, 
      // then update with suggestions. Let's do it in one go to prevent layout shift.
      
      let finalSuggestions: Record<string, Suggestion> = {};
      let finalSelected = new Set<string>();

      if (jdText && fetchedRepos.length > 0) {
        try {
          const suggRes = await fetch(`${API_BASE}/suggest-repos`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${activeToken}`
            },
            body: JSON.stringify({ 
              jdText, 
              repos: fetchedRepos.map((r: Repo) => ({
                name: r.name,
                description: r.description,
                language: r.language
              }))
            })
          });
          
          if (suggRes.ok) {
            const suggData = await suggRes.json();
            const suggs: Suggestion[] = suggData.suggestions || [];
            
            suggs.sort((a, b) => a.rank - b.rank);

            suggs.forEach((s, idx) => {
              finalSuggestions[s.name] = s;
              if (idx < 3) {
                finalSelected.add(s.name);
              }
            });
          }
        } catch (suggErr) {
          console.error('Failed to fetch suggestions (silent failure):', suggErr);
        }
      }

      setSuggestions(finalSuggestions);
      setSelectedRepos(finalSelected);
      setRepos(fetchedRepos);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleRepo = (repoName: string) => {
    const next = new Set(selectedRepos);
    if (next.has(repoName)) {
      next.delete(repoName);
    } else {
      next.add(repoName);
    }
    setSelectedRepos(next);
  };

  const handleGenerate = async () => {
    setGeneratingResume(true);
    setResumeSuccessUrl(null);
    setResumeError(null);
    
    try {
      const activeToken = await getFreshToken();
      const selectedRepoObjects = repos
        .filter(r => selectedRepos.has(r.name))
        .map(r => ({
          name: r.name,
          description: r.description,
          language: r.language,
          url: r.url,
          updatedAt: r.updatedAt
        }));

      // 1. Generate Content
      const generateRes = await fetch(`${API_BASE}/generate-ats-resume`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeToken}`
        },
        body: JSON.stringify({
          jobId,
          selectedRepos: selectedRepoObjects
        })
      });

      if (!generateRes.ok) {
        throw new Error('Failed to generate resume content');
      }

      // 2. Render PDF
      const renderRes = await fetch(`${API_BASE}/render-resume-pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${activeToken}`
        },
        body: JSON.stringify({ jobId })
      });

      if (!renderRes.ok) {
        throw new Error('Failed to render PDF');
      }

      const renderData = await renderRes.json();
      if (!renderData.downloadUrl) {
        throw new Error('Failed to get download URL from response');
      }

      setResumeSuccessUrl(renderData.downloadUrl);
    } catch (err: any) {
      setResumeError(err.message || 'An unexpected error occurred');
    } finally {
      setGeneratingResume(false);
    }
  };

  const sortedRepos = [...repos].sort((a, b) => {
    const sA = suggestions[a.name];
    const sB = suggestions[b.name];
    if (sA && sB) return sA.rank - sB.rank;
    if (sA) return -1;
    if (sB) return 1;
    return 0; // retain original order (stars descending)
  });

  return (
    <section className="results-section card">
      <div className="section-eyebrow">— select projects —</div>
      <h2>GitHub Projects</h2>
      
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        <input 
          type="text" 
          value={username} 
          onChange={(e) => setUsername(e.target.value)} 
          placeholder="GitHub username"
          style={{ flex: 1, padding: '0.75rem', borderRadius: '6px', border: '0.5px solid var(--border-color)', fontFamily: 'inherit' }}
        />
        <button onClick={handleFetch} disabled={loading || !username.trim()}>
          {loading ? 'Fetching...' : 'Fetch repos'}
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}
      
      {loading && <div className="spinner" style={{ margin: '2rem auto' }} />}

      {!loading && sortedRepos.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '2rem' }}>
          {sortedRepos.map(repo => {
            const suggestion = suggestions[repo.name];
            
            return (
              <label key={repo.name} className="repo-card" style={{ cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={selectedRepos.has(repo.name)}
                  onChange={() => toggleRepo(repo.name)}
                  style={{ marginTop: '0.25rem', width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <strong style={{ display: 'block', fontSize: '1.05rem', color: 'var(--text-primary)' }}>{repo.name}</strong>
                    {suggestion && (
                      <span className="seniority-pill" style={{ fontSize: '0.75rem', padding: '0.15rem 0.4rem' }}>
                        Suggested #{suggestion.rank}
                      </span>
                    )}
                  </div>
                  
                  <p className="repo-description">
                    {repo.description || 'No description provided.'}
                  </p>
                  
                  {suggestion && (
                    <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                      {suggestion.reason}
                    </p>
                  )}
                  
                  <div className="repo-meta">
                    {repo.language && <span>{repo.language}</span>}
                    <span>★ {repo.stars}</span>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      )}

      {sortedRepos.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <button 
            onClick={handleGenerate} 
            disabled={selectedRepos.size === 0 || generatingResume}
            style={{ width: '100%' }}
          >
            {generatingResume ? 'Generating your ATS resume...' : 'Generate ATS Resume'}
          </button>
          
          {(generatingResume || resumeSuccessUrl || resumeError) && (
            <div className={`status-panel ${resumeError && !generatingResume ? 'error' : ''}`} style={{ marginTop: '0' }}>
              {generatingResume && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                  <div className="spinner" />
                  <p style={{ margin: 0, fontWeight: 500 }}>Generating your ATS-optimized resume...</p>
                </div>
              )}
              {resumeError && !generatingResume && (
                <div>
                  <p style={{ color: 'var(--accent-warning, #ef4444)', fontWeight: 'bold', margin: '0 0 1rem 0' }}>
                    {resumeError}
                  </p>
                  <button onClick={handleGenerate} style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}>
                    Retry
                  </button>
                </div>
              )}
              {resumeSuccessUrl && !generatingResume && (
                <div>
                  <p style={{ color: '#10b981', fontWeight: 'bold', marginBottom: '1rem' }}>
                    ✅ Resume generated successfully!
                  </p>
                  <button 
                    onClick={() => window.open(resumeSuccessUrl, '_blank')}
                    style={{ background: '#10b981', color: 'white', border: 'none' }}
                  >
                    Download ATS Resume (PDF)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
