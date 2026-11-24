import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useVoterAuth from '../hooks/useVoterAuth';

const PURPLE = '#341D61';

export default function StudentLogin() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { loading, error, login } = useVoterAuth();
  const navigate = useNavigate();

  const submit = async (event) => {
    event.preventDefault();
    const result = await login(username, password);
    if (result.success) navigate('/student', { replace: true });
  };

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 20, background: '#fff', fontFamily: 'Arial, sans-serif' }}>
      <section style={{ width: '100%', maxWidth: 420, border: '1px solid #e5e1ec', borderRadius: 18, padding: 30, boxSizing: 'border-box', boxShadow: '0 12px 35px rgba(52,29,97,.10)' }}>
        <div style={{ textAlign: 'center', marginBottom: 26 }}>
          <h1 style={{ color: PURPLE, fontSize: 25, margin: '0 0 8px' }}>Voters Access</h1>
          <p style={{ color: '#5b5663', margin: 0, lineHeight: 1.5 }}>Sign in with your set and S/N.</p>
        </div>
        <form onSubmit={submit}>
          <label htmlFor="voter-username" style={labelStyle}>Username · Set</label>
          <input
            id="voter-username"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="set of 1990"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            disabled={loading}
            style={inputStyle}
          />
          <label htmlFor="voter-password" style={labelStyle}>Password · S/N</label>
          <input
            id="voter-password"
            name="password"
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            placeholder="Your S/N"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={loading}
            style={inputStyle}
          />
          {error && <p role="alert" style={{ color: '#b42318', background: '#fff1f0', padding: 12, borderRadius: 8, lineHeight: 1.45 }}>{error}</p>}
          <button type="submit" disabled={loading} style={{ width: '100%', marginTop: 8, padding: 13, background: PURPLE, color: '#fff', border: 0, borderRadius: 9, fontSize: 16, fontWeight: 700, cursor: loading ? 'wait' : 'pointer', opacity: loading ? .7 : 1 }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p style={{ margin: '18px 0 10px', textAlign: 'center', fontSize: 13, color: '#655d70' }}>Forgot your S/N? Contact the Election administrators through <Link to="/support" style={{ color: PURPLE, fontWeight: 700 }}>Support</Link>.</p>
        <div style={{ marginTop: 12, textAlign: 'center' }}>
          <Link to="/" style={{ color: PURPLE, fontSize: 14 }}>Return to home</Link>
        </div>
      </section>
    </main>
  );
}

const labelStyle = { display: 'block', color: '#332b3e', fontSize: 14, fontWeight: 700, margin: '16px 0 7px' };
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '12px 13px', border: '1px solid #d5d0dd', borderRadius: 9, fontSize: 16, outlineColor: PURPLE };
