import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export default function Support() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [officialContact, setOfficialContact] = useState({ email: '', phone: '' });

  useEffect(() => {
    fetch('/api/support')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.contact) setOfficialContact(data.contact); })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    
    if (!name || !message) {
      setError('Name and message are required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, message }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
      
      setSubmitted(true);
      setName(''); setEmail(''); setMessage('');
    } catch (e) {
      setError('Failed to send message: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: '#fff', color: '#341D61', fontFamily: 'Arial, sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ background: 'white', color: '#21143D', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '440px', boxShadow: '0 8px 30px rgba(0,0,0,0.4)' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '16px' }}>
          <img
            src="/logo.png"
            alt="SMCOAA Logo"
            style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', border: '3px solid #e6def2', margin: '0 auto 12px', display: 'block' }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
          <h1 style={{ margin: 0, fontSize: '22px' }}>SMCOAA ALUMNI ELECTION PORTAL</h1>
          <p style={{ margin: '6px 0 0', color: '#555' }}>💬 Chat / Support — Submit your complaints or request help</p>
          {(officialContact.email || officialContact.phone) && <div style={{ marginTop: 12, padding: 12, background: '#f7f4fb', borderRadius: 8, fontSize: 14 }}><strong>Official support contact</strong><div style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: 14, marginTop: 6 }}>{officialContact.email && <a href={`mailto:${officialContact.email}`} style={{ color: '#341D61' }}>{officialContact.email}</a>}{officialContact.phone && <a href={`tel:${officialContact.phone.replace(/[^+0-9]/g, '')}`} style={{ color: '#341D61' }}>{officialContact.phone}</a>}</div></div>}
        </div>

        {submitted ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '40px' }}>✓</div>
            <h2 style={{ margin: '8px 0' }}>Message Sent!</h2>
            <p>Your message has been received. We'll get back to you as soon as possible.</p>
            <Link to="/" style={{ display: 'inline-block', marginTop: '8px', padding: '10px 24px', background: '#341D61', color: '#fff', borderRadius: '8px', textDecoration: 'none', fontWeight: 'bold' }}>← Back to Home</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && (
              <div role="alert" aria-live="polite" style={{ background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 14px', marginBottom: '16px', fontSize: '14px' }}>
                ⚠️ {error}
              </div>
            )}

            <label htmlFor="support-name" style={{ display: 'block', fontWeight: 'bold', marginBottom: '6px' }}>Your Name *</label>
            <input id="support-name" name="name" type="text" value={name} maxLength={120} required onChange={(e) => setName(e.target.value)} style={{ width: '100%', padding: '14px 16px', border: '2px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', marginBottom: '20px' }}/>

            <label htmlFor="support-email" style={{ display: 'block', fontWeight: 'bold', marginBottom: '6px' }}>Email (optional)</label>
            <input id="support-email" name="email" type="email" value={email} maxLength={254} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%', padding: '14px 16px', border: '2px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', marginBottom: '20px' }}/>

            <label htmlFor="support-message" style={{ display: 'block', fontWeight: 'bold', marginBottom: '6px' }}>Your Message *</label>
            <textarea id="support-message" name="message" value={message} maxLength={5000} required rows={5} onChange={(e) => setMessage(e.target.value)} style={{ width: '100%', padding: '14px 16px', border: '2px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box', marginBottom: '20px', resize: 'vertical', fontFamily: 'inherit' }}/>

            <button 
              type="submit" 
              disabled={loading}
              style={{ 
                width: '100%', 
                padding: '14px', 
                background: loading ? '#e5e1ec' : '#341D61',
                color: loading ? '#514767' : '#fff', 
                border: 'none', 
                borderRadius: '8px', 
                fontWeight: 'bold', 
                fontSize: '16px', 
                cursor: loading ? 'not-allowed' : 'pointer'
              }}
            >
              {loading ? 'Sending...' : 'Send Message'}
            </button>

            <div style={{ textAlign: 'center', marginTop: '16px' }}>
              <Link to="/" style={{ color: '#50347B', textDecoration: 'underline' }}>← Back to Home</Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}