import React, { useState, useEffect } from 'react';
import axios from 'axios';

export default function Settings({ user, setUser }) {
  // Mirror the active profile into editable settings fields.
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Refresh the form whenever login/logout or local profile creation changes the active user.
    setName(user?.name || '');
    setEmail(user?.email || '');
  }, [user]);

  const save = async () => {
    // Persist profile changes and keep localStorage aligned with the backend response.
    if (!user || !user.id) return alert('No user');
    setSaving(true);
    try {
      const res = await axios.put(`http://localhost:5000/users/${user.id}`, { name, email });
      if (res.data) {
        const updated = res.data;
        setUser(updated);
        localStorage.setItem('user', JSON.stringify(updated));
        alert('Saved');
      }
    } catch (err) {
      alert(err.response?.data?.error || err.message);
    } finally { setSaving(false); }
  };

  if (!user) {
    // Settings can bootstrap a local profile when the user has skipped auth.
    return (
      <div>
        <h2 className="section-title">User Settings</h2>
        <div className="settings-card">
          <div className="entry-meta">Not logged in.</div>
          <div style={{ marginTop: '0.75rem' }}>
            <button className="btn btn-scan" onClick={async () => {
              try {
                const res = await axios.post('http://localhost:5000/users', { name: 'Local User', email: `local_${Date.now()}@local` });
                if (res.data) { setUser(res.data); localStorage.setItem('user', JSON.stringify(res.data)); alert('Local user created'); }
              } catch (e) { alert('Create user failed'); }
            }}>Create local user</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="section-title">User Settings</h2>
      <div className="settings-card">
        <label className="entry-meta">Name</label>
        <input className="input" value={name} onChange={e => setName(e.target.value)} />
        <label className="entry-meta">Email</label>
        <input className="input" value={email} onChange={e => setEmail(e.target.value)} />
        <div className="footer-right">
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}
