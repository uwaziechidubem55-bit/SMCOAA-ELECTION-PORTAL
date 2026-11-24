import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { superAdminApi } from '../utils/superAdminApi';

const PURPLE = '#341D61';
const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;

export default function AuditVerificationDashboard() {
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  const loadReport = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const response = await superAdminApi('superAuditVerification');
      setReport(response.report || null);
    } catch (e) {
      setError(e.message || 'Could not load the verification report.');
      if (/unauthorized|session required|401|403/i.test(e.message || '')) {
        localStorage.removeItem('smcoaa_superToken');
        navigate('/super-admin-login', { replace: true });
      }
    } finally {
      setBusy(false);
    }
  }, [navigate]);

  useEffect(() => { loadReport(); }, [loadReport]);

  const exportCsv = () => {
    if (!report) return;
    const rows = [['Section', 'Position', 'Candidate', 'Votes', 'Details']];
    rows.push(['Summary', '', 'Members on roll', report.summary.totalMembers, '']);
    rows.push(['Summary', '', 'Members marked voted', report.summary.votedMembers, '']);
    rows.push(['Summary', '', 'Distinct ballot audit events', report.summary.voteAuditActors, '']);
    rows.push(['Summary', '', 'Candidate vote total', report.summary.candidateVotes, '']);
    report.positions.forEach(position => position.candidates.forEach(candidate => rows.push(['Result', position.position, candidate.name, candidate.votes, ''])));
    report.discrepancies.forEach(item => rows.push(['Review', '', '', '', item.message]));
    report.recentEvents.forEach(event => rows.push(['Audit event', '', '', '', `${event.at} ${event.action}`]));
    const blob = new Blob([rows.map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'smcoaa-election-verification.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const card = { background: '#fff', border: '1px solid #e8e2f0', borderRadius: 14, padding: 18, boxShadow: '0 6px 18px rgba(52,29,97,.06)' };
  const metric = (label, value) => <div key={label} style={card}><div style={{ color: '#675d72', fontSize: 13 }}>{label}</div><strong style={{ display: 'block', marginTop: 8, color: PURPLE, fontSize: 26 }}>{Number(value || 0).toLocaleString()}</strong></div>;

  return (
    <main style={{ minHeight: '100vh', background: '#f8f7fa', padding: '24px clamp(16px, 4vw, 48px)', color: '#211a29', fontFamily: 'Arial,sans-serif' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 24 }}>
        <div><div style={{ color: PURPLE, fontSize: 13, fontWeight: 800 }}>SMCOAA · READ-ONLY CONTROL</div><h1 style={{ color: PURPLE, margin: '6px 0' }}>Election Audit &amp; Verification</h1><p style={{ color: '#675d72', margin: 0 }}>Review final tally totals and audit consistency. This dashboard cannot edit votes or election settings.</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button onClick={() => navigate('/super-admin-dashboard')} style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${PURPLE}`, color: PURPLE, background: '#fff', cursor: 'pointer' }}>← Super Admin</button><button onClick={loadReport} disabled={busy} style={{ padding: '10px 14px', borderRadius: 8, border: 0, color: '#fff', background: PURPLE, cursor: 'pointer' }}>{busy ? 'Refreshing…' : 'Refresh report'}</button><button onClick={exportCsv} disabled={!report} style={{ padding: '10px 14px', borderRadius: 8, border: `1px solid ${PURPLE}`, color: PURPLE, background: '#fff', cursor: 'pointer' }}>Export CSV</button></div>
      </header>

      {error && <div role="alert" style={{ ...card, marginBottom: 16, borderColor: '#fecaca', color: '#991b1b' }}>{error}</div>}
      {busy && !report && <div style={card}>Loading verification report…</div>}
      {report && <>
        <section aria-label="Verification summary" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 20 }}>
          {metric('Members on roll', report.summary.totalMembers)}{metric('Members marked voted', report.summary.votedMembers)}{metric('Distinct ballot audit events', report.summary.voteAuditActors)}{metric('Total candidate votes', report.summary.candidateVotes)}{metric('Positions', report.summary.positions)}
        </section>

        <section style={{ ...card, marginBottom: 20 }}>
          <h2 style={{ color: PURPLE, marginTop: 0 }}>Consistency review</h2>
          {report.discrepancies.length ? <div role="alert" style={{ padding: 14, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, color: '#9a3412' }}><strong>{report.discrepancies.length} item(s) need review</strong>{report.discrepancies.map(item => <p key={item.type} style={{ marginBottom: 0 }}>{item.message} Flags: {item.memberFlagCount}; vote audit events: {item.ballotAuditCount}.</p>)}</div> : <div role="status" style={{ padding: 14, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, color: '#166534' }}>No mismatch found between member vote flags and distinct ballot audit events.</div>}
          <p style={{ color: '#675d72', fontSize: 12, marginBottom: 0 }}>A mismatch is a review signal, not proof of wrongdoing. Audit records and candidate totals can require administrative reconciliation.</p>
        </section>

        <section style={{ ...card, marginBottom: 20 }}><h2 style={{ color: PURPLE, marginTop: 0 }}>Candidate totals by position</h2>{report.positions.length ? report.positions.map(position => <div key={position.position} style={{ padding: '12px 0', borderTop: '1px solid #eee' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}><strong>{position.position}</strong><span>{position.voteTotal.toLocaleString()} vote(s) · {position.candidateCount} candidate(s)</span></div><ul style={{ margin: '8px 0 0', paddingLeft: 22 }}>{position.candidates.map((candidate, index) => <li key={`${candidate.name}-${index}`}>{candidate.name}: {candidate.votes.toLocaleString()}</li>)}</ul></div>) : <p>No candidate totals recorded.</p>}</section>

        <section style={card}><h2 style={{ color: PURPLE, marginTop: 0 }}>Recent audit activity</h2><p style={{ color: '#675d72', fontSize: 13 }}>Member identities and S/Ns are excluded from this report.</p>{report.recentEvents.length ? <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}><thead><tr><th style={{ padding: 10, background: '#f4f0fa' }}>Time</th><th style={{ padding: 10, background: '#f4f0fa' }}>Event</th></tr></thead><tbody>{report.recentEvents.map((event, index) => <tr key={`${event.at}-${event.action}-${index}`}><td style={{ padding: 10, borderBottom: '1px solid #eee' }}>{event.at || '—'}</td><td style={{ padding: 10, borderBottom: '1px solid #eee' }}>{event.action}</td></tr>)}</tbody></table></div> : <p>No audit events recorded.</p>}<p style={{ color: '#675d72', fontSize: 12, marginBottom: 0 }}>Report generated: {new Date(report.generatedAt).toLocaleString()}</p></section>
      </>}
    </main>
  );
}
