import { useState } from 'react';

async function post(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = {};
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const error = new Error(data.message || 'Unable to sign in.');
    error.status = res.status;
    throw error;
  }
  return data;
}

/** Voter sign-in: set username + S/N password. No registration or PIN. */
export default function useVoterAuth() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const login = async (username, password) => {
    setLoading(true);
    setError('');
    try {
      const data = await post('/api/student-login', { username, password });
      const member = data.member;
      if (!member || !member.name || !member.set || !member.sn) {
        throw new Error('The member record could not be read. Please contact the administrator.');
      }
      const session = {
        name: member.name,
        sex: member.sex,
        set: member.set,
        sn: member.sn,
        hasVoted: Boolean(member.hasVoted),
      };
      localStorage.setItem('smcoaa_voterSession', JSON.stringify(session));
      return { success: true, member: session };
    } catch (err) {
      const message = err.status === 429
        ? err.message
        : err.status === 404
          ? 'Set or S/N does not match the membership roll.'
          : err.message || 'Unable to sign in. Please try again.';
      setError(message);
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  };

  return { loading, error, login, setError };
}
