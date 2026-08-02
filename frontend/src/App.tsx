import { Routes, Route, useNavigate, Link } from 'react-router-dom';
import AnalyzePage from './AnalyzePage';
import HistoryPage from './HistoryPage';
import GapTrendsPage from './GapTrendsPage';
import LoginPage from './LoginPage';
import { AuthProvider, ProtectedRoute, useAuth } from './AuthContext';
import './App.css';

function Nav() {
  const { token, logout } = useAuth();
  const navigate = useNavigate();

  if (!token) return null;

  return (
    <nav style={{ display: 'flex', justifyContent: 'flex-end', padding: '1rem', gap: '1rem', alignItems: 'center' }}>
      <Link to="/" style={{ color: '#5C5C57', textDecoration: 'none', fontWeight: '500' }}>New Analysis</Link>
      <Link to="/history" style={{ color: '#5C5C57', textDecoration: 'none', fontWeight: '500' }}>History</Link>
      <Link to="/gap-trends" style={{ color: '#5C5C57', textDecoration: 'none', fontWeight: '500' }}>Gap Trends</Link>
      <button 
        onClick={() => { logout(); navigate('/login'); }}
        style={{ padding: '0.5rem 1rem', background: '#FAFAF7', border: '1px solid #E8E4DB', color: '#1C1C1E', borderRadius: '6px', cursor: 'pointer' }}
      >
        Sign out
      </button>
    </nav>
  );
}

function App() {
  return (
    <AuthProvider>
      <Nav />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route 
          path="/" 
          element={
            <ProtectedRoute>
              <AnalyzePage />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/history" 
          element={
            <ProtectedRoute>
              <HistoryPage />
            </ProtectedRoute>
          } 
        />
        <Route 
          path="/gap-trends" 
          element={
            <ProtectedRoute>
              <GapTrendsPage />
            </ProtectedRoute>
          } 
        />
      </Routes>
    </AuthProvider>
  );
}

export default App;
