import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { signIn, signUp, confirmSignUp } from './auth';

type Mode = 'signin' | 'signup' | 'confirm';

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as any)?.from?.pathname || '/';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === 'signin') {
        const token = await signIn(email, password);
        login(token);
        navigate(from, { replace: true });
      } else if (mode === 'signup') {
        await signUp(email, password);
        setMode('confirm');
      } else if (mode === 'confirm') {
        await confirmSignUp(email, code);
        const token = await signIn(email, password);
        login(token);
        navigate(from, { replace: true });
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <h1>Job Tailor</h1>
      <p className="subtitle">
        {mode === 'signin' ? 'Sign in to your account' : mode === 'signup' ? 'Create a new account' : 'Verify your email'}
      </p>

      <form onSubmit={handleSubmit} className="submit-form card" style={{ maxWidth: '400px', margin: '0 auto' }}>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={mode === 'confirm'}
          />
        </label>

        {mode !== 'confirm' && (
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
        )}

        {mode === 'confirm' && (
          <label className="field">
            <span>Verification Code</span>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </label>
        )}

        {error && <p className="error-text">{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? 'Processing...' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Sign up' : 'Confirm'}
        </button>

        {mode === 'signin' && (
          <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
            Don't have an account? <a href="#" onClick={(e) => { e.preventDefault(); setMode('signup'); setError(null); }}>Sign up</a>
          </p>
        )}
        {mode === 'signup' && (
          <p style={{ marginTop: '1rem', fontSize: '0.9rem' }}>
            Already have an account? <a href="#" onClick={(e) => { e.preventDefault(); setMode('signin'); setError(null); }}>Sign in</a>
          </p>
        )}
      </form>
    </div>
  );
}
