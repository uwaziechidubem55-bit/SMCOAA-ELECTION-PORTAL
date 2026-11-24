import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { superAdminApi } from '../utils/superAdminApi';
import { adminApi } from '../utils/adminApi';
import { SkeletonBox, StatsGridSkeleton } from '../components/Skeleton';

const SUPER_VIEWS = [
  { key: 'overview', label: 'Overview', icon: '📊' },
  { key: 'activity', label: 'Live Monitor', icon: '👀' },
  { key: 'logins', label: 'Logins', icon: '🎓' },
  { key: 'election', label: 'Election', icon: '🗳️' },
  { key: 'system', label: 'System', icon: '🛠️' },
  { key: 'audit', label: 'Audit Log', icon: '📖' },
];

const COLORS = {
  bg: '#ffffff',
  panel: '#ffffff',
  navy: '#341D61',
  navySoft: '#50347B',
  gold: '#341D61',
  goldSoft: '#eee9f5',
  text: '#10233d',
  muted: '#64748b',
  border: '#e5edf5',
  success: '#16a34a',
  successSoft: '#dcfce7',
  warning: '#d97706',
  warningSoft: '#fef3c7',
  danger: '#dc2626',
  dangerSoft: '#fee2e2',
  info: '#50347B',
  infoSoft: '#e6def2',
  slateSoft: '#eef2f7',
};

const REFRESH_OPTIONS = [5000, 10000, 15000, 30000, 60000];

const cardShadow = '0 10px 28px rgba(15,45,82,0.08)';
const baseRadius = 18;


const safeDate = (value) => {
  try {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
};

const clock = (value) => {
  const d = safeDate(value);
  return d ? d.toLocaleTimeString() : '—';
};

const dateTime = (value) => {
  const d = safeDate(value);
  return d ? d.toLocaleString() : '—';
};

const relativeTime = (value) => {
  const d = safeDate(value);
  if (!d) return '—';
  const diff = Date.now() - d.getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
};

const pct = (value, total) => {
  if (!total) return 0;
  return Math.round((Number(value || 0) / Number(total || 1)) * 100);
};

const clamp = (num, min, max) => Math.max(min, Math.min(max, num));

const detailsText = (details) => {
  try {
    if (!details) return '—';
    if (typeof details === 'string') return details;
    return JSON.stringify(details);
  } catch {
    return '—';
  }
};

const csvEscape = (value) => {
  const str = value == null ? '' : String(value);
  return `"${str.replace(/"/g, '""')}"`;
};

const downloadTextFile = (filename, content, contentType = 'text/plain;charset=utf-8;') => {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const exportRowsToCsv = (filename, rows) => {
  if (!rows || !rows.length) return;
  const headers = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row || {}).forEach((key) => set.add(key));
      return set;
    }, new Set())
  );
  const lines = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => headers.map((key) => csvEscape(row[key])).join(',')),
  ];
  downloadTextFile(filename, lines.join('\n'), 'text/csv;charset=utf-8;');
};

const getTone = (tone) => {
  switch (tone) {
    case 'success':
      return { bg: COLORS.successSoft, fg: COLORS.success, bd: '#bbf7d0' };
    case 'warning':
      return { bg: COLORS.warningSoft, fg: COLORS.warning, bd: '#fde68a' };
    case 'danger':
      return { bg: COLORS.dangerSoft, fg: COLORS.danger, bd: '#fecaca' };
    case 'info':
      return { bg: COLORS.infoSoft, fg: COLORS.info, bd: '#bfdbfe' };
    case 'gold':
      return { bg: COLORS.goldSoft, fg: '#9a6700', bd: '#fde68a' };
    default:
      return { bg: COLORS.slateSoft, fg: COLORS.navy, bd: '#dbe4ef' };
  }
};

function Badge({ children, tone = 'default' }) {
  const c = getTone(tone);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.bd}`,
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {children}
    </span>
  );
}

function Panel({ title, subtitle, right, children, style = {} }) {
  return (
    <div
      style={{
        background: COLORS.panel,
        borderRadius: baseRadius,
        padding: 20,
        boxShadow: cardShadow,
        border: `1px solid ${COLORS.border}`,
        ...style,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 16,
        }}
      >
        <div>
          <h3 style={{ margin: 0, color: COLORS.text, fontSize: 18 }}>{title}</h3>
          {subtitle ? (
            <div style={{ marginTop: 6, fontSize: 13, color: COLORS.muted }}>{subtitle}</div>
          ) : null}
        </div>
        {right ? <div>{right}</div> : null}
      </div>
      {children}
    </div>
  );
}

function MetricCard({ icon, label, value, helper, tone = 'default' }) {
  const c = getTone(tone);
  return (
    <div
      style={{
        background: COLORS.panel,
        borderRadius: baseRadius,
        padding: 18,
        boxShadow: cardShadow,
        border: `1px solid ${COLORS.border}`,
        minWidth: 180,
        flex: '1 1 200px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ color: COLORS.muted, fontSize: 13, fontWeight: 700 }}>{label}</div>
          <div style={{ marginTop: 10, color: COLORS.text, fontSize: 28, fontWeight: 800 }}>{value}</div>
          {helper ? <div style={{ marginTop: 8, color: COLORS.muted, fontSize: 12 }}>{helper}</div> : null}
        </div>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            display: 'grid',
            placeItems: 'center',
            background: c.bg,
            color: c.fg,
            fontSize: 24,
            border: `1px solid ${c.bd}`,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

function MiniBar({ label, value, max, rightLabel, color = COLORS.navy }) {
  const width = max > 0 ? `${Math.max(6, (value / max) * 100)}%` : '0%';
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 10,
          marginBottom: 6,
          fontSize: 13,
          color: COLORS.text,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span style={{ fontWeight: 700, color: COLORS.muted }}>{rightLabel ?? value}</span>
      </div>
      <div style={{ height: 10, background: '#edf2f7', borderRadius: 999, overflow: 'hidden' }}>
        <div
          style={{
            width,
            height: '100%',
            borderRadius: 999,
            background: color,
            transition: 'width 0.25s ease',
          }}
        />
      </div>
    </div>
  );
}

function EmptyState({ title, subtitle }) {
  return (
    <div
      style={{
        padding: '28px 18px',
        textAlign: 'center',
        background: '#fbfdff',
        borderRadius: 16,
        border: `1px dashed ${COLORS.border}`,
      }}
    >
      <div style={{ fontWeight: 800, color: COLORS.text, marginBottom: 6 }}>{title}</div>
      <div style={{ color: COLORS.muted, fontSize: 13 }}>{subtitle}</div>
    </div>
  );
}

const buttonStyle = (variant = 'primary', disabled = false) => {
  const map = {
    primary: { bg: COLORS.navy, color: '#fff', border: COLORS.navy },
    gold: { bg: COLORS.gold, color: COLORS.navy, border: COLORS.gold },
    success: { bg: COLORS.success, color: '#fff', border: COLORS.success },
    danger: { bg: COLORS.danger, color: '#fff', border: COLORS.danger },
    ghost: { bg: '#fff', color: COLORS.text, border: COLORS.border },
    soft: { bg: COLORS.slateSoft, color: COLORS.text, border: '#d7e1ea' },
  };
  const c = map[variant] || map.primary;
  return {
    padding: '10px 14px',
    borderRadius: 12,
    border: `1px solid ${c.border}`,
    background: disabled ? '#e5e7eb' : c.bg,
    color: disabled ? '#94a3b8' : c.color,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 700,
    fontSize: 13,
    transition: 'all 0.2s ease',
  };
};

const inputStyle = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 12,
  border: `1px solid ${COLORS.border}`,
  background: '#fff',
  outline: 'none',
  fontSize: 14,
  color: COLORS.text,
  boxSizing: 'border-box',
};

const labelStyle = {
  display: 'block',
  marginBottom: 8,
  color: COLORS.text,
  fontSize: 13,
  fontWeight: 700,
};

const tableWrapStyle = {
  overflowX: 'auto',
  border: `1px solid ${COLORS.border}`,
  borderRadius: 14,
};

const thStyle = {
  textAlign: 'left',
  padding: '12px 14px',
  fontSize: 12,
  color: COLORS.muted,
  background: '#f8fbff',
  borderBottom: `1px solid ${COLORS.border}`,
  whiteSpace: 'nowrap',
};

const tdStyle = {
  padding: '12px 14px',
  fontSize: 13,
  color: COLORS.text,
  borderBottom: `1px solid ${COLORS.border}`,
  verticalAlign: 'top',
};

export default function SuperAdminDashboard() {
  const navigate = useNavigate();
  const pollRef = useRef(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState('overview');

  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [lastSync, setLastSync] = useState('');
  const [latencyMs, setLatencyMs] = useState(null);
  const [loading, setLoading] = useState(true);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshMs, setRefreshMs] = useState(10000);

  const [presenceFilter, setPresenceFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [auditSearch, setAuditSearch] = useState('');


  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [cleanupMsg, setCleanupMsg] = useState('');
  const [maintenanceEnabled, setMaintenanceEnabled] = useState(false);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState('');

  // ── Voter logins from the fixed membership roll ──
  const [loginRows, setLoginRows] = useState([]);
  const [loginsNextBefore, setLoginsNextBefore] = useState(null);
  const [loginsBusy, setLoginsBusy] = useState(false);
  const [loginsError, setLoginsError] = useState('');
  const [loginSearch, setLoginSearch] = useState('');
  const [loginView, setLoginView] = useState('people'); // 'people' = each person once | 'entries' = every entry
  const loginsCursorRef = useRef(null);

  const loadLogins = useCallback(async (older = false) => {
    setLoginsBusy(true);
    setLoginsError('');
    try {
      const res = await superAdminApi('superLogins', older && loginsCursorRef.current ? { before: loginsCursorRef.current } : {});
      const items = Array.isArray(res.items) ? res.items : [];
      setLoginRows((prev) => {
        if (!older) return items;
        const seen = new Set(prev.map((row) => row.id));
        return [...prev, ...items.filter((row) => !seen.has(row.id))];
      });
      loginsCursorRef.current = res.nextBefore || null;
      setLoginsNextBefore(res.nextBefore || null);
    } catch (e) {
      setLoginsError(e?.message || 'Could not load the logins.');
    } finally {
      setLoginsBusy(false);
    }
  }, []);

  // Fresh list every time the Logins screen is opened.
  useEffect(() => {
    if (activeView === 'logins') loadLogins(false);
  }, [activeView, loadLogins]);

  const loadStats = useCallback(async (showSpinner = false) => {
    const started = Date.now();
    try {
      if (showSpinner) setLoading(true);
      const res = await superAdminApi('superStats');
      setStats(res.stats || null);
      setError('');
      setLatencyMs(Date.now() - started);
      setLastSync(new Date().toISOString());
    } catch (e) {
      const msg = e?.message || 'Failed to load dashboard';
      setError(msg);
      if (e?.status === 401 || /unauthorized/i.test(msg)) {
        localStorage.removeItem('smcoaa_adminToken');
        localStorage.removeItem('smcoaa_superToken');
        navigate('/admin-login', { replace: true });
      } else if (e?.status === 403 || /super admin session required/i.test(msg)) {
        localStorage.removeItem('smcoaa_superToken');
        navigate('/super-admin-login', { replace: true });
      }
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    loadStats(true);
    superAdminApi('getMaintenanceWarning').then(data => setMaintenanceEnabled(Boolean(data.enabled))).catch(() => {});
  }, [loadStats]);

  const toggleMaintenanceWarning = async () => {
    setMaintenanceBusy(true);
    setMaintenanceMessage('');
    try {
      const result = await superAdminApi('setMaintenanceWarning', { enabled: !maintenanceEnabled });
      setMaintenanceEnabled(Boolean(result.enabled));
      setMaintenanceMessage(result.enabled ? 'Landing maintenance warning is ON.' : 'Landing page restored.');
    } catch (error) {
      setMaintenanceMessage(error.message || 'Could not update maintenance state.');
    } finally {
      setMaintenanceBusy(false);
    }
  };

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (autoRefresh) {
      pollRef.current = setInterval(() => {
        loadStats(false);
      }, refreshMs);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [autoRefresh, refreshMs, loadStats]);

  const cleanupPresence = async () => {
    const proceed = window.confirm('Clean up stale presence records now?');
    if (!proceed) return;

    setCleanupBusy(true);
    setCleanupMsg('Cleaning up stale presence records...');
    try {
      const res = await superAdminApi('superCleanupPresence');
      setCleanupMsg(`Cleanup complete. Removed ${res?.removed || 0} stale record(s).`);
      loadStats(false);
    } catch (e) {
      setCleanupMsg(e?.message || 'Cleanup failed.');
    } finally {
      setCleanupBusy(false);
    }
  };

  const endSuperSession = () => {
    localStorage.removeItem('smcoaa_superToken');
    navigate('/admin-dashboard');
  };

  const s = stats || {};
  const online = s.online || { count: 0, byPage: {}, list: [] };
  const people = s.people || {
    totalMembers: 0,
    voted: 0,
    loginsToday: 0,
    failedLogins: 0,
  };
  const election = s.election || { byPosition: {}, votesToday: 0, activeMode: 'none' };
  const support = s.support || { unread: 0, recent: [] };
  const audit = Array.isArray(s.audit) ? s.audit : [];

  const turnout = pct(people.voted, people.totalMembers);
  const pageRows = useMemo(
    () => Object.entries(online.byPage || {}).sort((a, b) => Number(b[1]) - Number(a[1])),
    [online.byPage]
  );

  const positionRows = useMemo(() => {
    return Object.entries(election.byPosition || {}).map(([position, list]) => {
      const topVotes = list?.[0]?.votes || 0;
      const totalVotes = (list || []).reduce((sum, item) => sum + (Number(item.votes) || 0), 0);
      return { position, list: list || [], topVotes, totalVotes };
    });
  }, [election.byPosition]);

  const candidateCount = useMemo(
    () => positionRows.reduce((sum, item) => sum + item.list.length, 0),
    [positionRows]
  );

  const leaders = useMemo(() => {
    return positionRows
      .map((item) => ({
        position: item.position,
        name: item.list?.[0]?.name || '—',
        votes: item.list?.[0]?.votes || 0,
      }))
      .filter((item) => item.name && item.name !== '—');
  }, [positionRows]);

  const filteredOnlineUsers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return (online.list || []).filter((row) => {
      const passRole = presenceFilter === 'all' ? true : row.role === presenceFilter;
      const hay = `${row.id} ${row.role} ${row.page} ${row.name || ''} ${row.set || ''} ${row.sn || ''}`.toLowerCase();
      return passRole && (!q || hay.includes(q));
    });
  }, [online.list, presenceFilter, searchTerm]);

  const filteredAudit = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return audit.filter((row) => {
      if (!q) return true;
      const hay = `${row.action || ''} ${row.actor || ''} ${row.person?.name || ''} ${row.person?.set || ''} ${row.person?.sn || ''} ${detailsText(row.details)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [audit, auditSearch]);

  // Logins — one row per person (their latest entry + how many times they entered).
  const loginPeople = useMemo(() => {
    const byMember = new Map();
    loginRows.forEach((row) => {
      const key = `${row.set || ''}-${row.sn || ''}`;
      const current = byMember.get(key);
      if (!current) {
        byMember.set(key, { ...row, entries: 1, lastAt: row.at });
      } else {
        current.entries += 1;
        if (String(row.at) > String(current.lastAt)) current.lastAt = row.at;
      }
    });
    return Array.from(byMember.values()).sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
  }, [loginRows]);

  const filteredLogins = useMemo(() => {
    const q = loginSearch.trim().toLowerCase();
    const source = loginView === 'people' ? loginPeople : loginRows;
    if (!q) return source;
    return source.filter((row) => `${row.name || ''} ${row.set || ''} ${row.sn || ''}`.toLowerCase().includes(q));
  }, [loginPeople, loginRows, loginSearch, loginView]);

  const healthScore = useMemo(() => {
    let score = 100;
    score -= clamp(Math.round((Number(latencyMs || 0) - 500) / 50), 0, 20);
    score -= clamp((people.failedLogins || 0) * 4, 0, 24);
    score -= clamp((support.unread || 0) * 2, 0, 12);
    if (!lastSync) score -= 10;
    if ((online.count || 0) === 0) score -= 5;
    return clamp(score, 0, 100);
  }, [latencyMs, people.failedLogins, support.unread, lastSync, online.count]);

  // Data Charge is a recommendation derived from the live operational snapshot, never a fee.
  const workloadIndex = clamp((Number(online.count || 0) / 50) + (Number(election.votesToday || 0) / 200) + (Number(support.unread || 0) / 10) + ((100 - healthScore) / 200), 0, 1);
  const recommendedMaintenanceNaira = Math.round((50000 + workloadIndex * 50000) / 5000) * 5000;

  const healthTone =
    healthScore >= 85 ? 'success' : healthScore >= 70 ? 'info' : healthScore >= 50 ? 'warning' : 'danger';

  const healthLabel =
    healthScore >= 85
      ? 'Excellent'
      : healthScore >= 70
      ? 'Stable'
      : healthScore >= 50
      ? 'Watch'
      : 'Critical';

  const alerts = useMemo(() => {
    const items = [];
    if ((people.failedLogins || 0) > 0) {
      items.push({
        tone: 'danger',
        text: `${people.failedLogins} failed login attempt(s) recorded today.`,
      });
    }
    if ((support.unread || 0) > 0) {
      items.push({
        tone: 'warning',
        text: `${support.unread} unread support message(s) need attention.`,
      });
    }
    if ((online.count || 0) === 0) {
      items.push({
        tone: 'warning',
        text: 'No active presence records detected right now.',
      });
    }
    if (!items.length) {
      items.push({
        tone: 'success',
        text: 'No active operational warnings right now.',
      });
    }
    return items;
  }, [people.failedLogins, support.unread, online.count]);



  const exportAuditCsv = () => {
    exportRowsToCsv(
      'super-admin-audit-log.csv',
      filteredAudit.map((row) => ({
        when: dateTime(row.at),
        action: row.action,
        actor: row.actor,
        name: row.person?.name || '',
        set: row.person?.set || '',
        sn: row.person?.sn || '',
        details: detailsText(row.details),
      }))
    );
  };


  const exportOnlineCsv = () => {
    exportRowsToCsv(
      'super-admin-online-users.csv',
      filteredOnlineUsers.map((row) => ({
        visitor_id: row.id,
        name: row.name || '',
        set: row.set || '',
        sn: row.sn || '',
        role: row.role,
        page: row.page,
        last_seen: dateTime(row.lastSeen),
      }))
    );
  };

  const exportLoginsCsv = () => {
    exportRowsToCsv(
      loginView === 'people' ? 'smcoaa-members-who-signed-in.csv' : 'smcoaa-voter-login-entries.csv',
      filteredLogins.map((row) => (loginView === 'people'
        ? {
            name: row.name,
            set: row.set,
            sn: row.sn,
            sex: row.sex,
            last_entered: dateTime(row.lastAt),
            times_entered: row.entries,
            voted: row.hasVoted ? 'Yes' : 'No',
          }
        : {
            name: row.name,
            set: row.set,
            sn: row.sn,
            sex: row.sex,
            entered: dateTime(row.at),
            how: 'Login',
            voted: row.hasVoted ? 'Yes' : 'No',
          }))
    );
  };

  const exportDashboardSnapshot = () => {
    downloadTextFile(
      'super-admin-dashboard-snapshot.json',
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          latencyMs,
          lastSync,
          stats,
        },
        null,
        2
      ),
      'application/json;charset=utf-8;'
    );
  };

  const renderOverview = () => (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <MetricCard
          icon="🟢"
          label="Live Users"
          value={online.count || 0}
          helper={`${pageRows.length} active page zone(s)`}
          tone="success"
        />
        <MetricCard
          icon="👥"
          label="Members on Roll"
          value={people.totalMembers || 0}
          helper={`${people.loginsToday || 0} voter sign-ins today`}
          tone="info"
        />
        <MetricCard
          icon="🗳️"
          label="Turnout"
          value={`${turnout}%`}
          helper={`${people.voted || 0} of ${people.totalMembers || 0} members voted`}
          tone="gold"
        />
        <MetricCard
          icon="⚡"
          label="Votes Today"
          value={election.votesToday || 0}
          helper={`Mode: ${election.activeMode || 'none'}`}
          tone="default"
        />
        <MetricCard
          icon="📩"
          label="Unread Support"
          value={support.unread || 0}
          helper={`${support.recent?.length || 0} recent support entries`}
          tone={support.unread ? 'warning' : 'success'}
        />
      </div>

      <Panel title="Data Charge · Maintenance Recommendation" subtitle="Operational workload summary only. No payment, invoice, fee, or collection is enabled.">
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div><strong style={{ color: '#341D61', fontSize: 22 }}>₦{recommendedMaintenanceNaira.toLocaleString()} recommended</strong><div style={{ color: COLORS.muted, fontSize: 13, marginTop: 5 }}>Range ₦50,000–₦100,000 · recommendation only</div></div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, color: COLORS.text, fontSize: 13 }}>
            <span>Health: <b>{healthScore}/100</b></span><span>Online now: <b>{online.count || 0}</b></span><span>Members: <b>{people.totalMembers || 0}</b></span><span>Votes: <b>{election.votesToday || 0} today</b></span><span>Support awaiting review: <b>{support.unread || 0}</b></span>
          </div>
        </div>
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${COLORS.border}` }}>
          <div style={{ color: COLORS.muted, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Live dashboard activity · visitors by page</div>
          {pageRows.length ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {pageRows.map(([page, count]) => <span key={page} style={{ background: '#f4f0fa', color: '#341D61', borderRadius: 999, padding: '5px 10px', fontSize: 12 }}><b>{count}</b> · {page}</span>)}
            </div>
          ) : <span style={{ color: COLORS.muted, fontSize: 12 }}>No active page visits in the current monitoring window.</span>}
        </div>
      </Panel>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.3fr 1fr',
          gap: 20,
          marginBottom: 20,
        }}
      >
        <Panel
          title="Operational Radar"
          subtitle="Fast read of what needs your attention right now."
          right={<Badge tone={healthTone}>Health {healthScore}/100 · {healthLabel}</Badge>}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 18 }}>
            <div>
              {alerts.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: '12px 14px',
                    borderRadius: 14,
                    marginBottom: 10,
                    border: `1px solid ${getTone(item.tone).bd}`,
                    background: getTone(item.tone).bg,
                    color: getTone(item.tone).fg,
                    fontWeight: 700,
                    fontSize: 13,
                  }}
                >
                  {item.text}
                </div>
              ))}
            </div>

            <div
              style={{
                border: `1px solid ${COLORS.border}`,
                borderRadius: 16,
                padding: 16,
                background: '#fbfdff',
              }}
            >
              <div style={{ color: COLORS.muted, fontSize: 12, fontWeight: 700, marginBottom: 8 }}>
                SYSTEM SNAPSHOT
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: COLORS.muted, fontSize: 13 }}>API latency</span>
                  <strong style={{ color: COLORS.text }}>{latencyMs != null ? `${latencyMs} ms` : '—'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: COLORS.muted, fontSize: 13 }}>Last sync</span>
                  <strong style={{ color: COLORS.text }}>{lastSync ? relativeTime(lastSync) : '—'}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: COLORS.muted, fontSize: 13 }}>Audit events loaded</span>
                  <strong style={{ color: COLORS.text }}>{audit.length}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ color: COLORS.muted, fontSize: 13 }}>Candidates tracked</span>
                  <strong style={{ color: COLORS.text }}>{candidateCount}</strong>
                </div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Hot Pages" subtitle="Where users are concentrated right now.">
          {pageRows.length ? (
            pageRows.map(([page, count]) => (
              <MiniBar
                key={page}
                label={page}
                value={Number(count) || 0}
                max={Number(pageRows[0]?.[1]) || 1}
                rightLabel={`${count} user(s)`}
                color={COLORS.navy}
              />
            ))
          ) : (
            <EmptyState title="No page activity" subtitle="Live page traffic will appear here as users browse the system." />
          )}
        </Panel>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 20,
          marginBottom: 20,
        }}
      >
        <Panel title="Election Leaders" subtitle="Top candidate per position.">
          {leaders.length ? (
            <div style={{ display: 'grid', gap: 10 }}>
              {leaders.map((item) => (
                <div
                  key={item.position}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '12px 14px',
                    borderRadius: 14,
                    border: `1px solid ${COLORS.border}`,
                    background: '#fbfdff',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800, color: COLORS.text }}>{item.position}</div>
                    <div style={{ fontSize: 13, color: COLORS.muted, marginTop: 4 }}>{item.name}</div>
                  </div>
                  <Badge tone="gold">👑 {item.votes} vote(s)</Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No leaders yet" subtitle="Candidate standings will appear once candidates and votes exist." />
          )}
        </Panel>
      </div>

      <Panel title="Support Inbox Snapshot" subtitle="Newest messages from users.">
        {support.recent?.length ? (
          <div style={tableWrapStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>When</th>
                  <th style={thStyle}>From</th>
                  <th style={thStyle}>Message</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {support.recent.map((msg) => (
                  <tr key={msg.id}>
                    <td style={tdStyle}>{dateTime(msg.timestamp)}</td>
                    <td style={{ ...tdStyle, fontWeight: 700 }}>{msg.name || '—'}</td>
                    <td style={tdStyle}>
                      <div style={{ maxWidth: 420, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {String(msg.message || '—')}
                      </div>
                    </td>
                    <td style={tdStyle}>
                      <Badge tone={msg.status === 'unread' ? 'warning' : 'success'}>
                        {msg.status === 'unread' ? 'Unread' : 'Read'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No support messages" subtitle="Support messages will show here when users contact the system." />
        )}
      </Panel>
    </>
  );

  const renderActivity = () => (
    <>
      <Panel
        title="Live Monitor"
        subtitle="Watch online visitors, their pages, and real-time event flow."
        right={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={exportOnlineCsv} style={buttonStyle('ghost')} type="button">
              Export online CSV
            </button>
            <Badge tone="success">{online.count} online now</Badge>
          </div>
        }
        style={{ marginBottom: 20 }}
      >
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 180, flex: '1 1 220px' }}>
            <label style={labelStyle}>Search users / pages</label>
            <input
              style={inputStyle}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search member, set, S/N, role, page..."
            />
          </div>
          <div style={{ minWidth: 180, flex: '0 0 220px' }}>
            <label style={labelStyle}>Role filter</label>
            <select
              style={inputStyle}
              value={presenceFilter}
              onChange={(e) => setPresenceFilter(e.target.value)}
            >
              <option value="all">All roles</option>
              <option value="admin">Admin</option>
              <option value="staff">Staff</option>
              <option value="voter">Voter</option>
              <option value="visitor">Visitor</option>
            </select>
          </div>
        </div>
      </Panel>

      <div style={{ display: 'grid', gridTemplateColumns: '1.05fr 1fr', gap: 20, marginBottom: 20 }}>
        <Panel title="Active Sessions" subtitle="Presence feed for everyone currently online.">
          {filteredOnlineUsers.length ? (
            <div style={tableWrapStyle}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Visitor</th>
                    <th style={thStyle}>Role</th>
                    <th style={thStyle}>Page</th>
                    <th style={thStyle}>Last Seen</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOnlineUsers.map((row) => (
                    <tr key={row.id}>
                      {row.name || row.memberId ? (
                        <td style={tdStyle}>
                          <div style={{ fontWeight: 700 }}>{row.name || 'Voter'}</div>
                          <div style={{ fontSize: 12, color: COLORS.muted, fontFamily: 'monospace' }}>
                            {row.set ? `Set of ${row.set}` : ''}{row.sn ? ` · S/N ${row.sn}` : ''}
                          </div>
                        </td>
                      ) : (
                        <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{row.id}</td>
                      )}
                      <td style={tdStyle}>
                        <Badge
                          tone={
                            row.role === 'admin'
                              ? 'gold'
                              : row.role === 'staff'
                              ? 'info'
                              : row.role === 'voter'
                              ? 'success'
                              : 'default'
                          }
                        >
                          {row.role || 'visitor'}
                        </Badge>
                      </td>
                      <td style={tdStyle}>{row.page || '—'}</td>
                      <td style={tdStyle}>{dateTime(row.lastSeen)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No matching sessions" subtitle="Try another search or role filter." />
          )}
        </Panel>

        <Panel title="Page Concentration" subtitle="Which screens users are spending time on.">
          {pageRows.length ? (
            pageRows.map(([page, count]) => (
              <MiniBar
                key={page}
                label={page}
                value={Number(count) || 0}
                max={Number(pageRows[0]?.[1]) || 1}
                rightLabel={`${count} active`}
                color={COLORS.navySoft}
              />
            ))
          ) : (
            <EmptyState title="No live page traffic" subtitle="Activity bars appear when active presence records are available." />
          )}
        </Panel>
      </div>

      <Panel
        title="Recent Event Feed"
        subtitle="Newest system actions from the audit stream."
        right={<Badge tone="info">{audit.length} loaded event(s)</Badge>}
      >
        {audit.length ? (
          <div style={{ display: 'grid', gap: 10 }}>
            {audit.slice(0, 25).map((item) => {
              const tone =
                String(item.action || '').includes('FAILED')
                  ? 'danger'
                  : String(item.action || '').includes('VOTE')
                  ? 'success'
                  : 'default';

              return (
                <div
                  key={item.id}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '110px 180px 1fr',
                    gap: 12,
                    padding: '12px 14px',
                    borderRadius: 14,
                    border: `1px solid ${COLORS.border}`,
                    background: '#fbfdff',
                    alignItems: 'start',
                  }}
                >
                  <div style={{ color: COLORS.muted, fontSize: 12 }}>{clock(item.at)}</div>
                  <div>
                    <Badge tone={tone}>{item.action || 'UNKNOWN'}</Badge>
                  </div>
                  <div>
                    <div style={{ color: COLORS.text, fontWeight: 700 }}>
                      {item.person
                        ? `${item.person.name || 'Name not on record'} · Set ${item.person.set || ''} · S/N ${item.person.sn || ''}`
                        : (item.actor || 'Unknown actor')}
                    </div>
                    <div style={{ color: COLORS.muted, fontSize: 12, marginTop: 4 }}>
                      {detailsText(item.details)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="No recent events" subtitle="Audit activity will appear here automatically." />
        )}
      </Panel>
    </>
  );

  const renderElection = () => (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <MetricCard icon="🏁" label="Election Mode" value={election.activeMode || 'none'} helper="Current operating mode" tone="gold" />
        <MetricCard icon="🧑‍💼" label="Positions" value={positionRows.length} helper="Tracked offices" tone="info" />
        <MetricCard icon="🙋" label="Candidates" value={candidateCount} helper="Across all positions" tone="default" />
        <MetricCard icon="⚡" label="Votes Today" value={election.votesToday || 0} helper="Today's recorded vote actions" tone="success" />
      </div>

      {positionRows.length ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          {positionRows.map((item) => (
            <Panel
              key={item.position}
              title={item.position}
              subtitle={`${item.list.length} candidate(s) · ${item.totalVotes} total vote(s)`}
              right={
                item.list?.[0] ? (
                  <Badge tone="gold">
                    👑 {item.list[0].name} · {item.list[0].votes}
                  </Badge>
                ) : null
              }
            >
              {item.list.length ? (
                item.list.map((candidate) => (
                  <MiniBar
                    key={candidate.id}
                    label={candidate.name}
                    value={Number(candidate.votes) || 0}
                    max={item.topVotes || 1}
                    rightLabel={`${candidate.votes} vote(s)`}
                    color={candidate.votes === item.topVotes && item.topVotes > 0 ? COLORS.gold : COLORS.navy}
                  />
                ))
              ) : (
                <EmptyState title="No candidates" subtitle="Candidate data will appear here when available." />
              )}
            </Panel>
          ))}
        </div>
      ) : (
        <Panel title="Election Standings" subtitle="No candidate data is available yet.">
          <EmptyState title="No election standings" subtitle="Add candidates or wait for data to load." />
        </Panel>
      )}
    </>
  );


  const renderSystem = () => (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <MetricCard icon="🧠" label="Health Score" value={`${healthScore}/100`} helper={healthLabel} tone={healthTone} />
        <MetricCard icon="📶" label="API Latency" value={latencyMs != null ? `${latencyMs} ms` : '—'} helper="Latest fetch roundtrip" tone="info" />
        <MetricCard icon="⏱️" label="Auto Refresh" value={autoRefresh ? 'On' : 'Off'} helper={`Every ${refreshMs / 1000}s`} tone={autoRefresh ? 'success' : 'warning'} />
        <MetricCard icon="🔐" label="Session State" value={localStorage.getItem('smcoaa_superToken') ? 'Active' : 'Missing'} helper="Super admin token check" tone={localStorage.getItem('smcoaa_superToken') ? 'success' : 'danger'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
        <Panel title="Refresh Controls" subtitle="Tune how the dashboard keeps itself updated.">
          <div style={{ display: 'grid', gap: 14 }}>
            <div>
              <label style={labelStyle}>Refresh interval</label>
              <select
                style={inputStyle}
                value={refreshMs}
                onChange={(e) => setRefreshMs(Number(e.target.value))}
              >
                {REFRESH_OPTIONS.map((ms) => (
                  <option key={ms} value={ms}>
                    Every {ms / 1000} second(s)
                  </option>
                ))}
              </select>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => setAutoRefresh((v) => !v)} style={buttonStyle(autoRefresh ? 'warning' : 'success')}>
                {autoRefresh ? 'Pause auto refresh' : 'Resume auto refresh'}
              </button>
              <button type="button" onClick={() => loadStats(false)} style={buttonStyle('primary')}>
                Refresh now
              </button>
            </div>
          </div>
        </Panel>

        <Panel title="Quick Actions" subtitle="Maintenance and export tools for super admin work.">
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <button type="button" onClick={cleanupPresence} style={buttonStyle('danger', cleanupBusy)} disabled={cleanupBusy}>
              {cleanupBusy ? 'Cleaning...' : 'Cleanup stale presence'}
            </button>
            <button type="button" onClick={toggleMaintenanceWarning} style={buttonStyle(maintenanceEnabled ? 'danger' : 'primary', maintenanceBusy)} disabled={maintenanceBusy}>
              {maintenanceBusy ? 'Updating…' : maintenanceEnabled ? 'Turn off Landing Maintenance Warning' : 'Turn on Landing Maintenance Warning'}
            </button>
            <button type="button" onClick={exportDashboardSnapshot} style={buttonStyle('ghost')}>
              Export JSON snapshot
            </button>
            <button type="button" onClick={exportAuditCsv} style={buttonStyle('soft')}>
              Export audit CSV
            </button>
          </div>
          {maintenanceMessage ? <div role="status" style={{ color: maintenanceEnabled ? COLORS.warning : COLORS.success, margin: '8px 0' }}>{maintenanceMessage}</div> : null}
          {cleanupMsg ? (
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 12,
                background: '#fbfdff',
                border: `1px solid ${COLORS.border}`,
                color: COLORS.text,
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              {cleanupMsg}
            </div>
          ) : null}
        </Panel>
      </div>

      <Panel title="Diagnostics Board" subtitle="Server-time and operational state at a glance.">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
          <div style={{ padding: 16, borderRadius: 14, background: '#fbfdff', border: `1px solid ${COLORS.border}` }}>
            <div style={{ color: COLORS.muted, fontSize: 12, fontWeight: 800 }}>SERVER TIME</div>
            <div style={{ marginTop: 8, color: COLORS.text, fontWeight: 800 }}>{dateTime(s.serverTime)}</div>
          </div>
          <div style={{ padding: 16, borderRadius: 14, background: '#fbfdff', border: `1px solid ${COLORS.border}` }}>
            <div style={{ color: COLORS.muted, fontSize: 12, fontWeight: 800 }}>LAST CLIENT SYNC</div>
            <div style={{ marginTop: 8, color: COLORS.text, fontWeight: 800 }}>{dateTime(lastSync)}</div>
          </div>
          <div style={{ padding: 16, borderRadius: 14, background: '#fbfdff', border: `1px solid ${COLORS.border}` }}>
            <div style={{ color: COLORS.muted, fontSize: 12, fontWeight: 800 }}>LOGIN RISK</div>
            <div style={{ marginTop: 8, color: COLORS.text, fontWeight: 800 }}>{people.failedLogins || 0} failed login(s)</div>
          </div>
          <div style={{ padding: 16, borderRadius: 14, background: '#fbfdff', border: `1px solid ${COLORS.border}` }}>
            <div style={{ color: COLORS.muted, fontSize: 12, fontWeight: 800 }}>SUPPORT LOAD</div>
            <div style={{ marginTop: 8, color: COLORS.text, fontWeight: 800 }}>{support.unread || 0} unread ticket(s)</div>
          </div>
        </div>
      </Panel>
    </>
  );

  const renderAudit = () => (
    <>
      <Panel
        title="Audit Diary"
        subtitle="Search through system actions, actors and details."
        right={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={exportAuditCsv} style={buttonStyle('ghost')}>
              Export CSV
            </button>
            <Badge tone="info">{filteredAudit.length} visible</Badge>
          </div>
        }
        style={{ marginBottom: 20 }}
      >
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 240, flex: '1 1 360px' }}>
            <label style={labelStyle}>Search action / actor / details</label>
            <input
              style={inputStyle}
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              placeholder="Search audit action, actor or details..."
            />
          </div>
        </div>
      </Panel>

      <Panel title="Audit Records" subtitle="Most recent audit events loaded from the server.">
        {filteredAudit.length ? (
          <div style={tableWrapStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>When</th>
                  <th style={thStyle}>Action</th>
                  <th style={thStyle}>Actor</th>
                  <th style={thStyle}>Details</th>
                </tr>
              </thead>
              <tbody>
                {filteredAudit.map((row) => (
                  <tr key={row.id}>
                    <td style={tdStyle}>{dateTime(row.at)}</td>
                    <td style={tdStyle}>
                      <Badge tone={String(row.action || '').includes('FAILED') ? 'danger' : 'default'}>
                        {row.action || 'UNKNOWN'}
                      </Badge>
                    </td>
                    <td style={tdStyle}>
                      {row.person ? (
                        <>
                          <div style={{ fontWeight: 700 }}>{row.person.name || '—'}</div>
                          <div style={{ fontSize: 12, color: COLORS.muted, fontFamily: 'monospace' }}>
                            Set {row.person.set || '—'} · S/N {row.person.sn || '—'}
                          </div>
                        </>
                      ) : (row.actor || '—')}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>
                      <div style={{ maxWidth: 520, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                        {detailsText(row.details)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No audit records found" subtitle="Try a different search or wait for new activity." />
        )}
      </Panel>
    </>
  );

  const renderLogins = () => {
    const people = loginView === 'people';
    return (
      <>
        <Panel
          title="Logins"
          subtitle="Voter sign-ins resolved against the fixed alumni membership roll."
          right={
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button type="button" onClick={exportLoginsCsv} style={buttonStyle('ghost')}>
                Export CSV
              </button>
              <button type="button" onClick={() => loadLogins(false)} style={buttonStyle('primary', loginsBusy)} disabled={loginsBusy}>
                {loginsBusy ? 'Loading...' : 'Refresh'}
              </button>
              <Badge tone="success">{loginPeople.length} people</Badge>
              <Badge tone="info">{loginRows.length} entries</Badge>
            </div>
          }
          style={{ marginBottom: 20 }}
        >
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 220, flex: '1 1 320px' }}>
              <label style={labelStyle}>Search name / set / S/N</label>
              <input
                style={inputStyle}
                value={loginSearch}
                onChange={(e) => setLoginSearch(e.target.value)}
                placeholder="Type a name, set or S/N..."
              />
            </div>
            <div style={{ minWidth: 180, flex: '0 0 250px' }}>
              <label style={labelStyle}>Show</label>
              <select style={inputStyle} value={loginView} onChange={(e) => setLoginView(e.target.value)}>
                <option value="people">Each person once (latest entry)</option>
                <option value="entries">Every entry</option>
              </select>
            </div>
          </div>
          {loginsError && (
            <div style={{ marginTop: 12, color: COLORS.danger, fontWeight: 700, fontSize: 13 }}>{loginsError}</div>
          )}
        </Panel>

        <Panel
          title={people ? 'People who entered' : 'Every entry'}
          subtitle="Newest first. Member identity is matched from the fixed alumni roll; there is no registration flow."
        >
          {filteredLogins.length ? (
            <div style={tableWrapStyle}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Set</th>
                    <th style={thStyle}>S/N</th>
                    <th style={thStyle}>Sex</th>
                    <th style={thStyle}>{people ? 'Last entered' : 'Entered'}</th>
                    <th style={thStyle}>{people ? 'Times' : 'How'}</th>
                    <th style={thStyle}>Voted</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogins.map((row) => (
                    <tr key={people ? `p-${row.set}-${row.sn}` : row.id}>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>
                        {row.name || '—'}
                        {!row.known && (
                          <div style={{ fontSize: 11, fontWeight: 400, color: COLORS.muted }}>record is not currently on the fixed member roll</div>
                        )}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace' }}>{row.set ? `Set of ${row.set}` : '—'}</td>
                      <td style={tdStyle}>{row.sn || '—'}</td>
                      <td style={tdStyle}>{row.sex || '—'}</td>
                      <td style={tdStyle}>{dateTime(people ? row.lastAt : row.at)}</td>
                      <td style={tdStyle}>
                        {people ? row.entries : (
                          <Badge tone={'info'}>{'Login'}</Badge>
                        )}
                      </td>
                      <td style={tdStyle}>
                        <Badge tone={row.hasVoted ? 'success' : 'default'}>{row.hasVoted ? 'Yes' : 'No'}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title={loginsBusy ? 'Loading...' : 'No entries found'}
              subtitle={loginsBusy ? 'Reading the login records.' : 'Nobody matches this search, or nobody has entered yet.'}
            />
          )}
          {loginsNextBefore && (
            <div style={{ marginTop: 14, textAlign: 'center' }}>
              <button type="button" onClick={() => loadLogins(true)} style={buttonStyle('ghost', loginsBusy)} disabled={loginsBusy}>
                {loginsBusy ? 'Loading...' : 'Load older entries'}
              </button>
            </div>
          )}
        </Panel>
      </>
    );
  };

  const renderActiveView = () => {
    switch (activeView) {
      case 'activity':
        return renderActivity();
      case 'logins':
        return renderLogins();
      case 'election':
        return renderElection();
      case 'system':
        return renderSystem();
      case 'audit':
        return renderAudit();
      case 'overview':
      default:
        return renderOverview();
    }
  };

  if (loading && !stats && !error) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: `linear-gradient(135deg, ${COLORS.navy} 0%, #50347B 100%)`,
          padding: 24,
          fontFamily: 'Arial, sans-serif',
          paddingBottom: 48,
        }}
      >
        <div style={{ maxWidth: 1180, margin: '0 auto' }}>
          {/* Header bar skeleton */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <SkeletonBox style={{ height: '26px', width: '240px' }} />
            <SkeletonBox style={{ height: '36px', width: '130px', borderRadius: '18px' }} />
          </div>

          {/* Live stats cards */}
          <StatsGridSkeleton count={4} />

          {/* View tabs skeleton (Overview / Live Monitor / Election / ...) */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '22px 0 18px' }}>
            {SUPER_VIEWS.map((v, i) => (
              <SkeletonBox key={v.key} style={{ height: '32px', width: `${90 + (i % 3) * 26}px`, borderRadius: '16px' }} />
            ))}
          </div>

          {/* Main content panel skeleton */}
          <div style={{
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 20,
            padding: 20,
          }}>
            <SkeletonBox style={{ height: '18px', width: '260px', marginBottom: 18 }} />
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '10px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <SkeletonBox style={{ height: '14px', width: '18%' }} />
                <SkeletonBox style={{ height: '14px', flex: 1 }} />
                <SkeletonBox style={{ height: '14px', width: '90px' }} />
                <SkeletonBox style={{ height: '22px', width: '70px', borderRadius: '11px' }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div
        style={{
          minHeight: '100vh',
          background: `linear-gradient(135deg, ${COLORS.navy} 0%, #50347B 100%)`,
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          fontFamily: 'Arial, sans-serif',
        }}
      >
        <div
          style={{
            background: '#fff',
            borderRadius: 20,
            padding: 28,
            maxWidth: 520,
            boxShadow: cardShadow,
            border: `1px solid ${COLORS.border}`,
            textAlign: 'center',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 10 }}>⚠️</div>
          <div style={{ color: COLORS.text, fontSize: 24, fontWeight: 800 }}>Unable to load dashboard</div>
          <div style={{ color: COLORS.muted, marginTop: 12, fontSize: 14 }}>{error}</div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 20 }}>
            <button type="button" onClick={() => loadStats(true)} style={buttonStyle('primary')}>
              Retry
            </button>
            <button type="button" onClick={() => navigate('/admin-dashboard')} style={buttonStyle('ghost')}>
              Back to Admin
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: COLORS.bg, fontFamily: 'Arial, sans-serif', color: COLORS.text }}>
      <style>{`
        * { box-sizing: border-box; }
        .sa-scroll::-webkit-scrollbar { width: 10px; height: 10px; }
        .sa-scroll::-webkit-scrollbar-thumb { background: #cdd8e3; border-radius: 999px; }
        .sa-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>

      {sidebarOpen ? (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2, 12, 27, 0.35)',
            zIndex: 40,
          }}
        />
      ) : null}

      <aside
        className="sa-scroll"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: 280,
          background: `linear-gradient(180deg, ${COLORS.navy} 0%, #50347B 100%)`,
          padding: 20,
          transform: sidebarOpen ? 'translateX(0)' : 'translateX(-292px)',
          transition: 'transform 0.25s ease',
          zIndex: 50,
          overflowY: 'auto',
          boxShadow: '20px 0 40px rgba(0,0,0,0.15)',
        }}
      >
        <div
          style={{
            padding: 18,
            borderRadius: 18,
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.08)',
            marginBottom: 20,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,0.7)', marginBottom: 8 }}>
            CONTROL ROOM
          </div>
          <div style={{ color: COLORS.gold, fontSize: 24, fontWeight: 900 }}>Super Admin</div>
          <div style={{ color: 'rgba(255,255,255,0.82)', fontSize: 13, marginTop: 8 }}>
            Live oversight for operations, voting and audit.
          </div>
          <button type="button" onClick={() => navigate('/audit-verification')} style={{ marginTop: 14, width: '100%', padding: '11px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.22)', background: 'rgba(255,255,255,0.12)', color: '#fff', fontWeight: 800, cursor: 'pointer' }}>🔍 Open Audit &amp; Verification</button>
        </div>

        <div style={{ display: 'grid', gap: 8 }}>
          {SUPER_VIEWS.map((item) => {
            const active = activeView === item.key;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setActiveView(item.key);
                  setSidebarOpen(false);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                  padding: '14px 16px',
                  borderRadius: 14,
                  border: active ? '1px solid rgba(245,200,76,0.45)' : '1px solid transparent',
                  background: active ? 'rgba(245,200,76,0.12)' : 'transparent',
                  color: active ? COLORS.gold : 'rgba(255,255,255,0.82)',
                  cursor: 'pointer',
                  fontWeight: 800,
                  fontSize: 14,
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 18 }}>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 24, display: 'grid', gap: 10 }}>
          <button type="button" onClick={() => navigate('/admin-dashboard')} style={buttonStyle('ghost')}>
            ← Back to Admin Dashboard
          </button>
          <button type="button" onClick={endSuperSession} style={buttonStyle('danger')}>
            🔒 End super session
          </button>
        </div>
      </aside>

      <main style={{ maxWidth: 1400, margin: '0 auto', padding: 20 }}>
        <div
          style={{
            background: `linear-gradient(135deg, ${COLORS.navy} 0%, #50347B 100%)`,
            borderRadius: 26,
            padding: 22,
            color: '#fff',
            boxShadow: cardShadow,
            marginBottom: 22,
            border: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 18,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: 14,
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(255,255,255,0.08)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontSize: 20,
                  fontWeight: 800,
                }}
              >
                ☰
              </button>
              <div>
                <div style={{ color: 'rgba(255,255,255,0.72)', fontSize: 12, fontWeight: 800 }}>
                  SMCOAA CONTROL CENTER
                </div>
                <h1 style={{ margin: '6px 0 8px', fontSize: 30, color: COLORS.gold }}>
                  Super Admin Dashboard
                </h1>
                <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 14, maxWidth: 760 }}>
                  Cleaner structure, stronger visibility, and faster access to live election, financial and system intelligence.
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 10, minWidth: 260 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <Badge tone="success">LIVE · {online.count} online</Badge>
                <Badge tone={healthTone}>Health {healthScore}/100</Badge>
                <Badge tone="gold">{election.activeMode || 'none'}</Badge>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                }}
              >
                <select
                  value={refreshMs}
                  onChange={(e) => setRefreshMs(Number(e.target.value))}
                  style={{
                    ...inputStyle,
                    width: 140,
                    padding: '10px 12px',
                    background: 'rgba(255,255,255,0.1)',
                    color: '#fff',
                    border: '1px solid rgba(255,255,255,0.15)',
                  }}
                >
                  {REFRESH_OPTIONS.map((ms) => (
                    <option key={ms} value={ms} style={{ color: COLORS.text }}>
                      {ms / 1000}s refresh
                    </option>
                  ))}
                </select>

                <button type="button" onClick={() => setAutoRefresh((v) => !v)} style={buttonStyle(autoRefresh ? 'warning' : 'success')}>
                  {autoRefresh ? 'Pause' : 'Resume'}
                </button>
                <button type="button" onClick={() => loadStats(false)} style={buttonStyle('gold')}>
                  Refresh now
                </button>
              </div>

              <div style={{ textAlign: 'right', color: 'rgba(255,255,255,0.72)', fontSize: 12 }}>
                Last sync: {lastSync ? `${dateTime(lastSync)} (${relativeTime(lastSync)})` : '—'}
              </div>
            </div>
          </div>
        </div>

        {error ? (
          <div
            style={{
              marginBottom: 20,
              padding: '12px 14px',
              borderRadius: 14,
              background: COLORS.dangerSoft,
              color: COLORS.danger,
              border: '1px solid #fecaca',
              fontWeight: 700,
              fontSize: 13,
            }}
          >
            {error}
          </div>
        ) : null}

        {renderActiveView()}
      </main>
    </div>
  );
}
