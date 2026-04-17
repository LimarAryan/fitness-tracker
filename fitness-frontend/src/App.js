import React, { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import Calories from './Calories';
import Exercises from './Exercises';
import Settings from './Settings';

const API = axios.create({ baseURL: 'http://localhost:5000' });

// Restores the last active profile so refreshes keep the user in the same fitness workspace.
function readStoredUser() {
  try {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function App() {
  // Top-level app state controls the active screen and the lightweight auth/profile panel.
  const [activeTab, setActiveTab] = useState('calories');
  const [user, setUser] = useState(readStoredUser);
  const [authMode, setAuthMode] = useState('login');
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    // Reattach the saved JWT to future API calls after a page reload.
    const token = localStorage.getItem('token');
    if (token) API.defaults.headers.common.Authorization = `Bearer ${token}`;
  }, []);

  const tabs = useMemo(
    // Keep the tab list stable so React does not rebuild it on every render.
    () => [
      { id: 'calories', label: 'Calories' },
      { id: 'exercises', label: 'Exercises' },
      { id: 'settings', label: 'Settings' }
    ],
    []
  );

  const handleAuthChange = (event) => {
    // Update the auth form by input name so login and register can share one handler.
    const { name, value } = event.target;
    setAuthForm((current) => ({ ...current, [name]: value }));
  };

  const submitAuth = async (event) => {
    // Sends either login or registration data, then stores the returned token/profile locally.
    event.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    try {
      const endpoint = authMode === 'login' ? '/auth/login' : '/auth/register';
      const payload = authMode === 'login'
        ? { email: authForm.email, password: authForm.password }
        : authForm;
      const res = await API.post(endpoint, payload);
      const nextUser = res.data.user || null;

      if (res.data.token) {
        localStorage.setItem('token', res.data.token);
        API.defaults.headers.common.Authorization = `Bearer ${res.data.token}`;
      }

      if (nextUser) {
        setUser(nextUser);
        localStorage.setItem('user', JSON.stringify(nextUser));
        localStorage.setItem('fitness_user_id', nextUser.id);
      }
    } catch (err) {
      setAuthError(err.response?.data?.error || err.message || 'Authentication failed');
    } finally {
      setAuthLoading(false);
    }
  };

  const createLocalUser = async () => {
    // Local profiles let someone use the tracker without creating a password-backed account.
    setAuthError('');
    setAuthLoading(true);
    try {
      const res = await API.post('/users', {
        name: 'Local User',
        email: `local_${Date.now()}@local`
      });
      if (res.data) {
        setUser(res.data);
        localStorage.setItem('user', JSON.stringify(res.data));
        localStorage.setItem('fitness_user_id', res.data.id);
      }
    } catch (err) {
      setAuthError(err.response?.data?.error || err.message || 'Could not create local user');
    } finally {
      setAuthLoading(false);
    }
  };

  const logout = () => {
    // Clear all persisted identity so meal and settings screens return to an anonymous state.
    delete API.defaults.headers.common.Authorization;
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('fitness_user_id');
    setUser(null);
  };

  const renderActiveTab = () => {
    // Route the simple tab state to the fitness section component currently selected.
    if (activeTab === 'exercises') return <Exercises />;
    if (activeTab === 'settings') return <Settings user={user} setUser={setUser} />;
    return <Calories />;
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Fitness Dashboard</p>
          <h1>Track meals, macros, and training</h1>
        </div>
        <div className="user-panel">
          {user ? (
            <>
              <div>
                <div className="entry-meta">Active profile</div>
                <div className="font-medium">{user.name || user.email || `User #${user.id}`}</div>
              </div>
              <button className="btn btn-ghost btn-small" onClick={logout} type="button">
                Log out
              </button>
            </>
          ) : (
            <span className="entry-meta">Use an account or local profile to save entries.</span>
          )}
        </div>
      </header>

      {!user && (
        <section className="auth-panel">
          <form className="auth-form" onSubmit={submitAuth}>
            <div className="auth-toggle" role="tablist" aria-label="Authentication mode">
              <button
                className={authMode === 'login' ? 'selected' : ''}
                onClick={() => setAuthMode('login')}
                type="button"
              >
                Login
              </button>
              <button
                className={authMode === 'register' ? 'selected' : ''}
                onClick={() => setAuthMode('register')}
                type="button"
              >
                Register
              </button>
            </div>

            {authMode === 'register' && (
              <input
                className="input"
                name="name"
                placeholder="Name"
                value={authForm.name}
                onChange={handleAuthChange}
              />
            )}
            <input
              className="input"
              name="email"
              placeholder="Email"
              type="email"
              value={authForm.email}
              onChange={handleAuthChange}
            />
            <input
              className="input"
              name="password"
              placeholder="Password"
              type="password"
              value={authForm.password}
              onChange={handleAuthChange}
            />

            <div className="auth-actions">
              <button className="btn btn-primary" disabled={authLoading} type="submit">
                {authLoading ? 'Saving...' : authMode === 'login' ? 'Login' : 'Create account'}
              </button>
              <button className="btn btn-scan" disabled={authLoading} onClick={createLocalUser} type="button">
                Local profile
              </button>
            </div>
            {authError && <div className="form-error">{authError}</div>}
          </form>
        </section>
      )}

      <nav className="tab-bar" aria-label="Fitness sections">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            onClick={() => setActiveTab(tab.id)}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="content-panel">{renderActiveTab()}</main>
    </div>
  );
}

export default App;
