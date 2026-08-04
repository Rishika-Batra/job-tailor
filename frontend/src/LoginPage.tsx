import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { signIn, signUp, confirmSignUp } from './auth';
import './LoginPage.css';

export default function LoginPage() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
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
      if (isConfirming) {
        await confirmSignUp(email, code);
        setIsConfirming(false);
        setIsSignUp(false);
      } else if (isSignUp) {
        const result = await signUp(email, password);
        if (result.nextStep?.signUpStep === 'CONFIRM_SIGN_UP') {
          setIsConfirming(true);
        }
      } else {
        await signIn(email, password);
        login();
        navigate(from, { replace: true });
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-scene">
      {/* SVG Watercolor / Paint Turbulence Filters */}
      <svg className="cloud-svg-filter">
        <defs>
          <filter id="cloud-wave-1" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.008 0.018" numOctaves="4" seed="12" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="140" xChannelSelector="R" yChannelSelector="G" />
          </filter>
          <filter id="cloud-wave-2" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.015 0.025" numOctaves="5" seed="45" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="180" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      {/* Layered Diagonal Organic Cloud Waves */}
      <div className="cloud-wave wave-back" />
      <div className="cloud-wave wave-mid-dark" />
      <div className="cloud-wave wave-mid-purple" />
      <div className="cloud-wave wave-front-bright" />
      <div className="cloud-wave wave-bottom-glow" />

      {/* Dust Particles and Star Field */}
      <div className="star-dust-overlay" />

      {/* Four-Point Stars */}
      <div className="sparkle-star star-left-mid">✦</div>
      <div className="sparkle-star star-right-top">✦</div>
      <div className="sparkle-star star-right-mid">✦</div>
      <div className="sparkle-star star-right-bottom">✦</div>
      <div className="sparkle-star star-bottom-left">✦</div>

      <div className="login-wrap">
        <form onSubmit={handleSubmit} className="login-card">
          <div className="mini-globe-icon">
            <div className="mini-ring" />
            <div className="mini-ring r2" />
          </div>

          <h1>Job Tailor</h1>
          <p className="subtitle">
            {isConfirming
              ? 'Enter verification code'
              : isSignUp
              ? 'Create a new account'
              : 'Sign in to your account'}
          </p>

          {error && <div className="login-error">{error}</div>}

          {isConfirming ? (
            <div className="input-group">
              <label>Verification Code</label>
              <input
                type="text"
                placeholder="Enter code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </div>
          ) : (
            <>
              <div className="input-group">
                <label>Email</label>
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="input-group">
                <label>Password</label>
                <input
                  type="password"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </>
          )}

          <button type="submit" className="submit-btn" disabled={loading}>
            {loading ? 'Processing...' : isConfirming ? 'Verify' : isSignUp ? 'Sign up' : 'Sign in'}
          </button>

          <p className="login-toggle">
            {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
            <span onClick={() => setIsSignUp(!isSignUp)}>
              {isSignUp ? 'Sign in' : 'Sign up'}
            </span>
          </p>
        </form>
      </div>
    </div>
  );
}
