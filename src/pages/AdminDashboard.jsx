import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '../utils/adminApi';
import { winnersByPosition } from '../utils/positions';
import { SkeletonBox, StatsGridSkeleton } from '../components/Skeleton';

const MAX_PER_POSITION = 5;
const MAX_PHOTO_KB = 500; // Max candidate photo size in KB (passport-photo size)
const ALLOWED_PHOTO_TYPES = ['image/jpeg', 'image/jpg'];

// Refresh protected database data without reloading or flashing the dashboard.
const DATABASE_SYNC_INTERVAL_MS = 10000;
const EMPTY_ELECTION_SETTINGS = {
  year: '', startDate: '', startTime: '', endDate: '', endTime: '', isActive: false
};

// Helper to generate random candidate ID
const generateCandidateId = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 7; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return 'SMCOAA-' + id;
};

// ===================== HIGH-PRECISION AUTO-COMPRESS (TARGET: ~499 KB) =====================
// Uses binary-search quality optimization to retain maximum sharpness right up to 499 KB without cutting/cropping
const compressImage = (file, maxKB = 499) => {
  const maxBytes = maxKB * 1024;
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => { img.src = e.target.result; };
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // Keep maximum native resolution up to 2400px preserving full aspect ratio (no cutting)
      const maxDim = 2400;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);

      const getBlob = (q) => new Promise(res => canvas.toBlob(res, 'image/jpeg', q));

      let minQ = 0.10;
      let maxQ = 0.99;
      let bestBlob = null;

      // 1. If 99% full quality is already under 499 KB, keep full quality
      const fullBlob = await getBlob(0.99);
      if (fullBlob && fullBlob.size <= maxBytes) {
        bestBlob = fullBlob;
      } else {
        // 2. Binary search to find highest quality that stays right at ~480KB–499KB
        for (let i = 0; i < 8; i++) {
          const midQ = (minQ + maxQ) / 2;
          const currentBlob = await getBlob(midQ);
          if (currentBlob && currentBlob.size <= maxBytes) {
            bestBlob = currentBlob;
            minQ = midQ;
          } else {
            maxQ = midQ;
          }
        }
        if (!bestBlob) {
          bestBlob = await getBlob(0.75);
        }
      }

      if (!bestBlob) {
        reject(new Error('Compression failed'));
        return;
      }

      const compressedFile = new File(
        [bestBlob],
        (file.name || 'candidate').replace(/\.[^/.]+$/, '') + '.jpg',
        { type: 'image/jpeg', lastModified: Date.now() }
      );
      resolve(compressedFile);
    };
    img.onerror = () => reject(new Error('Could not read image file'));
    reader.readAsDataURL(file);
  });
};

// ===================== CLOUDINARY PHOTO UPLOAD =====================
// The browser uploads DIRECTLY to Cloudinary using a short-lived signature
// issued by /api/upload. CLOUDINARY_API_SECRET never leaves the server.
const uploadPhotoToCloudinary = async (file) => {
  // 1) Ask the server for signed upload params (admin JWT required)
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (localStorage.getItem('smcoaa_adminToken') || ''),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Upload permission denied');
  }
  const { cloudName, apiKey, timestamp, folder, allowedFormats, signature } = await res.json();

  // 2) Upload the file straight to Cloudinary's CDN endpoint
  const form = new FormData();
  form.append('file', file);
  form.append('api_key', apiKey);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('allowed_formats', allowedFormats);
  form.append('signature', signature);

  const up = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: form,
  });
  if (!up.ok) {
    const err = await up.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Cloudinary upload failed');
  }
  const data = await up.json();
  return data.secure_url; // https://res.cloudinary.com/<cloud>/image/upload/...
};

// ===================== AUTO-REPLY GENERATOR =====================
const generateAutoReply = (msg) => {
  const text = String(msg.message || '').toLowerCase();
  const header = `Thank you for contacting the St. Michael's College, Oleh Alumni Association Election Portal.\n\n`;
  if (/vote|election|ballot|cast/i.test(text)) {
    return `${header}Voters sign in with their set username and S/N password. They may select one candidate in each position and submit their ballot during the scheduled election period.\n\nThe portal records and tallies votes by position.`;
  }
  if (/login|password|s\/n|serial|set of/i.test(text)) {
    return `${header}Use your set as the username (for example, set of 1990) and your S/N as the password. Your name and other membership details come from the code roll; you do not need to enter your name.`;
  }
  if (/candidate|position|contest/i.test(text)) {
    return `${header}Please contact the Election administrators for candidate and position information.`;
  }
  if (/result|winner|count/i.test(text)) {
    return `${header}Vote totals and election results are calculated by the portal and reviewed by the Election administrators.`;
  }
  if (/issue|problem|error|not working|complaint/i.test(text)) {
    return `${header}Your message has been received. The support team will review the issue and respond.`;
  }
  return `${header}Your message has been received. Please include the relevant election details so the support team can assist you.`;
};

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState('dashboard');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Prevent overlapping background refreshes and protect unsaved settings edits.
  const databaseSyncInProgressRef = useRef(false);
  const databaseSyncQueuedRef = useRef(false);
  const settingsDirtyRef = useRef(false);
  const supportContactDirtyRef = useRef(false);

  const [candidates, setCandidates] = useState([]);
  const [name, setName] = useState('');
  const [position, setPosition] = useState('');
  const [dept, setDept] = useState('');
  const [manifesto, setManifesto] = useState('');
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [editingCandidate, setEditingCandidate] = useState(null);
  const [oversizedFile, setOversizedFile] = useState(null);
  const [compressing, setCompressing] = useState(false);

  const [settings, setSettings] = useState({
    year: '', startDate: '', startTime: '', endDate: '', endTime: '', isActive: false
  });
  const [supportContact, setSupportContact] = useState({ email: '', phone: '' });
  const [supportContactMsg, setSupportContactMsg] = useState({ type: '', text: '' });
  const [memberNameQuery, setMemberNameQuery] = useState('');
  const [memberLookupResults, setMemberLookupResults] = useState([]);
  const [memberLookupMsg, setMemberLookupMsg] = useState('');
  const [memberLookupBusy, setMemberLookupBusy] = useState(false);
  const [rosterBusy, setRosterBusy] = useState(false);
  const [rosterMessage, setRosterMessage] = useState({ type: '', text: '' });
  const [rosterCsv, setRosterCsv] = useState('');
  const [rosterPreview, setRosterPreview] = useState(null);

  const [voters, setVoters] = useState([]);
  const [supportMessages, setSupportMessages] = useState([]);



  // ===================== PRINT RESULTS STATE =====================
  const [electionResults, setElectionResults] = useState([]);
  const [resultsGenerated, setResultsGenerated] = useState(false);
  const [printLoading, setPrintLoading] = useState(false);
  const [printMsg, setPrintMsg] = useState('');

  // ===================== ACTIVATION STATE =====================
  const [activeMode, setActiveMode] = useState('none');
  const [activationLoading, setActivationLoading] = useState(false);
  const [activationMsg, setActivationMsg] = useState({ type: '', text: '' });

  // ===================== SUPER ADMIN (control room) STATE =====================
  const [superCode, setSuperCode] = useState('');
  const [superCodeBusy, setSuperCodeBusy] = useState(false);
  const [superCodeMsg, setSuperCodeMsg] = useState({ type: '', text: '' });
  const saveSuperCode = async () => {
    if (!superCode.trim()) {
      setSuperCodeMsg({ type: 'error', text: 'Enter a code first (at least 6 characters).' });
      return;
    }
    setSuperCodeBusy(true);
    setSuperCodeMsg({ type: '', text: '' });
    try {
      const res = await adminApi('setSuperAdminCode', { newCode: superCode.trim() });
      setSuperCodeMsg({ type: 'success', text: res.message || 'Super admin code saved.' });
      setSuperCode('');
    } catch (e) {
      setSuperCodeMsg({ type: 'error', text: e.message || 'Failed to save code.' });
    } finally {
      setSuperCodeBusy(false);
    }
  };

  // ===================== LOAD ACTIVATION (server-side now) =====================
  const loadActivation = async () => {
    try {
      const mainRes = await adminApi('getMainSettings');
      if (!mainRes.data) {
        // The settings/main document was deleted: remove its old value from the UI.
        if (!supportContactDirtyRef.current) setSupportContact({ email: '', phone: '' });
        setActiveMode('none');
        return;
      }

      if (mainRes.data) {
        const data = mainRes.data;
        if (!supportContactDirtyRef.current) setSupportContact({ email: data.supportContactEmail || '', phone: data.supportContactPhone || '' });
        let currentMode = data.activeMode || 'none';
        const now = new Date();

        // ===== AUTO-STOP ELECTION IF END DATE/TIME HAS PASSED =====
        // The PORTAL's clock decides whether the end time has passed — not the
        // clock of the device this dashboard is open on. If the portal cannot
        // be asked, nothing is stopped here (the portal itself already refuses
        // votes after the end time).
        if (currentMode === 'election' || currentMode === 'both') {
          let portalStatus = null;
          try {
            portalStatus = (await adminApi('getElectionStatus')).status || null;
          } catch (statusError) {
            portalStatus = null;
          }
          if (portalStatus && portalStatus.endDate && portalStatus.endTime
            && portalStatus.endAt && portalStatus.serverNow >= portalStatus.endAt) {
            console.log('[Auto-Stop] Election end time passed. Auto-stopping election.');
            const newMode = 'none';
            await adminApi('saveMainSettings', { data: { activeMode: newMode, isActive: false } });
            currentMode = newMode;
          }
        }

        setActiveMode(currentMode);
      }
    } catch (e) {
      console.error('Load activation error:', e);
    }
  };

  // ===================== ACTIVATION HANDLERS =====================
  const handleActivate = async (type) => {
    setActivationLoading(true);
    setActivationMsg({ type: '', text: '' });
    try {
      const newMode = 'election';

      // Write to settings/main
      await adminApi('saveMainSettings', { data: { activeMode: newMode } });

      if (type === 'election') {
        // Copy election settings into settings/main so Voter Dashboard reads them
        const electionRes = await adminApi('getElectionSettings');
        if (electionRes.data) {
          const data = electionRes.data;
          await adminApi('saveMainSettings', {
            data: {
              isActive: true,
              startDate: data.startDate || '',
              startTime: data.startTime || '',
              endDate: data.endDate || '',
              endTime: data.endTime || '',
              year: data.year || ''
            }
          });
        }
      }


      setActiveMode(newMode);
      setActivationMsg({ type: 'success', text: '✅ Election activated!' });
      setTimeout(() => setActivationMsg({ type: '', text: '' }), 4000);
    } catch (e) {
      setActivationMsg({ type: 'error', text: '❌ Error: ' + e.message });
    }
    setActivationLoading(false);
  };

  const handleToggleStop = async (type) => {
    setActivationLoading(true);
    setActivationMsg({ type: '', text: '' });
    try {
      const newMode = 'none';

      await adminApi('saveMainSettings', { data: { activeMode: newMode } });

      if (type === 'election') {
        await adminApi('saveMainSettings', { data: { isActive: false } });
      }


      setActiveMode(newMode);
      setActivationMsg({ type: 'success', text: '✅ Election stopped. Results now available.' });
      setTimeout(() => setActivationMsg({ type: '', text: '' }), 4000);
    } catch (e) {
      setActivationMsg({ type: 'error', text: '❌ Error: ' + e.message });
    }
    setActivationLoading(false);
  };

  const applyStoredResults = (storedData, currentCandidates = null) => {
    let nextResults = Array.isArray(storedData?.results) ? [...storedData.results] : [];
    const candidateIds = storedData?.candidateIds || {};

    if (Array.isArray(currentCandidates) && Object.keys(candidateIds).length > 0) {
      const positionCounts = {};
      const liveByGeneratedId = new Map();

      currentCandidates.forEach((candidate) => {
        positionCounts[candidate.position] = (positionCounts[candidate.position] || 0) + 1;
        const generatedId = candidateIds[candidate.id];
        if (generatedId) liveByGeneratedId.set(generatedId, candidate);
      });

      nextResults = nextResults
        .filter(result => liveByGeneratedId.has(result.candidateId))
        .map(result => {
          const liveCandidate = liveByGeneratedId.get(result.candidateId);
          const totalInPosition = positionCounts[liveCandidate.position] || 1;
          const votes = Number(liveCandidate.votes || 0);
          return {
            ...result,
            name: liveCandidate.name,
            position: liveCandidate.position,
            votes,
            votePoint: (votes / totalInPosition).toFixed(2),
            dept: liveCandidate.dept || ''
          };
        })
        .sort((a, b) => {
          if (a.position !== b.position) return a.position.localeCompare(b.position);
          return b.votes - a.votes;
        })
        .map((result, index) => ({ ...result, sNo: index + 1 }));
    }

    setElectionResults(nextResults);
    setResultsGenerated(nextResults.length > 0);
  };

  // Initial load shows the loading screen. Later calls are silent database syncs.
  const loadAllData = async (showLoadingScreen = true) => {
    if (databaseSyncInProgressRef.current) {
      databaseSyncQueuedRef.current = true;
      return;
    }
    databaseSyncInProgressRef.current = true;

    if (showLoadingScreen) {
      setLoading(true);
      setError('');
    }

    try {
      const [
        candidatesResult,
        settingsResult,
        votersResult,
        supportResult,
        resultsResult
      ] = await Promise.allSettled([
        adminApi('listCandidates'),
        adminApi('getElectionSettings'),
        adminApi('listMembers'),
        adminApi('listSupport'),
        adminApi('getResults')
      ]);

      let currentCandidates = null;

      if (candidatesResult.status === 'fulfilled') {
        currentCandidates = candidatesResult.value.items || [];
        setCandidates(currentCandidates);

      } else {
        throw candidatesResult.reason;
      }

      if (settingsResult.status === 'fulfilled' && !settingsDirtyRef.current) {
        // A null response means settings/election was deleted.
        setSettings(settingsResult.value.data || { ...EMPTY_ELECTION_SETTINGS });
      }

      if (votersResult.status === 'fulfilled') {
        setVoters(votersResult.value.items || []);
      }

      if (supportResult.status === 'fulfilled') {
        setSupportMessages(supportResult.value.items || []);
      }

      if (resultsResult.status === 'fulfilled') {
        applyStoredResults(resultsResult.value.data, currentCandidates);
      }

      // These existing context loaders update the context-owned values used here.
      await loadActivation();

      if (showLoadingScreen) setError('');
    } catch (e) {
      console.error(showLoadingScreen ? 'Admin load error:' : 'Admin background sync error:', e);
      const message = e?.message || '';
      const unauthorized = e?.status === 401 || /unauthorized/i.test(message);
      if (unauthorized) {
        localStorage.removeItem('smcoaa_adminToken');
        localStorage.removeItem('smcoaa_superToken');
        setError('Admin session expired. Please sign in again.');
        navigate('/admin-login', { replace: true });
      } else if (showLoadingScreen) {
        setError('Failed to load data. Make sure Firestore database is created in Firebase Console.');
      }
    } finally {
      databaseSyncInProgressRef.current = false;
      if (showLoadingScreen) setLoading(false);

      if (databaseSyncQueuedRef.current) {
        databaseSyncQueuedRef.current = false;
        window.setTimeout(() => loadAllData(false), 0);
      }
    }
  };

  const seedFixedRoster = async () => {
    const confirmed = window.confirm('Add any missing members from the current fixed voter roll? Existing member records and vote states will not be changed.');
    if (!confirmed || rosterBusy) return;
    setRosterBusy(true);
    setRosterMessage({ type: '', text: '' });
    try {
      const result = await adminApi('seedFixedRoster');
      setRosterMessage({ type: 'success', text: `Complete: ${result.created} added; ${result.alreadyPresent} already existed. Existing vote records were preserved.` });
      await loadAllData(false);
    } catch (error) {
      setRosterMessage({ type: 'error', text: error.message || 'Could not load the fixed voter roll.' });
    } finally {
      setRosterBusy(false);
    }
  };

  const previewRosterCsv = async (file) => {
    setRosterCsv('');
    setRosterPreview(null);
    setRosterMessage({ type: '', text: '' });
    if (!file) return;
    if (file.size > 1024 * 1024) {
      setRosterMessage({ type: 'error', text: 'CSV must be 1 MB or smaller.' });
      return;
    }
    try {
      const csvText = await file.text();
      const result = await adminApi('previewMemberImport', { csvText });
      setRosterCsv(csvText);
      setRosterPreview(result.preview);
      setRosterMessage({ type: 'success', text: `Validated ${result.preview.total} rows. ${result.preview.toCreate} new members will be added; ${result.preview.alreadyPresent} existing IDs will be skipped.` });
    } catch (error) {
      setRosterMessage({ type: 'error', text: error.message || 'CSV validation failed. No records were written.' });
    }
  };

  const importRosterCsv = async () => {
    if (!rosterCsv || !rosterPreview || rosterBusy) return;
    const confirmed = window.confirm(`Add ${rosterPreview.toCreate} new member(s)? Existing records, including hasVoted, will not be changed. No records are deleted.`);
    if (!confirmed) return;
    setRosterBusy(true);
    setRosterMessage({ type: '', text: '' });
    try {
      const result = await adminApi('importMemberCsv', { csvText: rosterCsv });
      setRosterMessage({ type: 'success', text: `Import complete: ${result.created} added; ${result.alreadyPresent} existing IDs skipped. Existing member documents and vote states were preserved.` });
      setRosterCsv('');
      setRosterPreview(null);
      const input = document.getElementById('member-roster-csv');
      if (input) input.value = '';
      await loadAllData(false);
    } catch (error) {
      setRosterMessage({ type: 'error', text: error.message || 'Import failed. No existing vote state was changed.' });
    } finally {
      setRosterBusy(false);
    }
  };

  useEffect(() => {
    loadAllData(true);

    const syncIfVisible = () => {
      if (document.visibilityState === 'visible') {
        loadAllData(false);
      }
    };

    const syncTimer = window.setInterval(syncIfVisible, DATABASE_SYNC_INTERVAL_MS);
    window.addEventListener('focus', syncIfVisible);
    document.addEventListener('visibilitychange', syncIfVisible);

    return () => {
      window.clearInterval(syncTimer);
      window.removeEventListener('focus', syncIfVisible);
      document.removeEventListener('visibilitychange', syncIfVisible);
    };
  }, []);


  const sortedByVotes = [...candidates].sort((a, b) => (b.votes || 0) - (a.votes || 0));
  const unreadMessages = supportMessages.filter(m => m.status === 'unread').length;
  const activeVoters = voters.filter(v => v.hasVoted).length;

  const sidebarItems = [
    { key: 'dashboard', label: 'Dashboard', icon: '📊' },
    { key: 'settings', label: 'Election Settings', icon: '⚙️' },
    { key: 'member-lookup', label: 'Find Member S/N', icon: '🔎' },
    { key: 'voter-roll', label: 'Voter Roll Import', icon: '📥' },
    { key: 'candidates', label: 'Manage Candidates', icon: '👥' },
    { key: 'activation', label: 'Activation', icon: '🔘' },
    { key: 'results', label: 'Election Results', icon: '📈' },
    { key: 'print-results', label: 'Print Results', icon: '🖨️' },
    { key: 'messages', label: `Messages (${unreadMessages})`, icon: '✉️' },
    { key: 'super-admin', label: 'Super Admin', icon: '🛡️' },
  ];

  const inputStyle = {
    width: '100%', padding: '12px 14px', border: '1px solid #ddd',
    borderRadius: '8px', marginBottom: '12px', boxSizing: 'border-box',
    fontSize: '14px', outline: 'none'
  };
  const cardStyle = {
    background: 'white', borderRadius: '12px', padding: '24px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)', marginBottom: '20px'
  };
  const statCardStyle = {
    background: 'white', borderRadius: '12px', padding: '20px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)', textAlign: 'center',
    flex: '1', minWidth: '200px'
  };
  const btnPrimary = {
    padding: '12px 24px', background: '#341D61', color: 'white',
    border: 'none', borderRadius: '8px', cursor: 'pointer',
    fontWeight: 'bold', fontSize: '14px'
  };
  const btnDanger = { ...btnPrimary, background: '#dc2626' };
  const btnSuccess = { ...btnPrimary, background: '#16a34a' };
  const btnWarning = { ...btnPrimary, background: '#f59e0b', color: '#341D61' };
  const labelStyle = {
    display: 'block', fontSize: '12px', fontWeight: 'bold', color: '#475569',
    textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: '6px'
  };

  const handleSaveSettings = async () => {
    try {
      await adminApi('saveElectionSettings', { data: settings });
      settingsDirtyRef.current = false;
      alert('✅ Saved!');
    }
    catch (e) { alert('Error: ' + e.message); }
  };

  const handleFindMemberSn = async (event) => {
    event.preventDefault();
    setMemberLookupBusy(true);
    setMemberLookupMsg('');
    setMemberLookupResults([]);
    try {
      const result = await adminApi('findMemberSnByName', { name: memberNameQuery });
      setMemberLookupResults(result.items || []);
      if (!result.items?.length) setMemberLookupMsg('No matching member found. Check the spelling and try again.');
    } catch (error) {
      setMemberLookupMsg(error.message || 'Could not search the member roll.');
    } finally {
      setMemberLookupBusy(false);
    }
  };

  const handleSaveSupportContact = async () => {
    const email = supportContact.email.trim();
    const phone = supportContact.phone.trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setSupportContactMsg({ type: 'error', text: 'Enter a valid support email address.' });
      return;
    }
    if (email.length > 254 || phone.length > 32) {
      setSupportContactMsg({ type: 'error', text: 'Email or phone number is too long.' });
      return;
    }
    setSupportContactMsg({ type: '', text: '' });
    try {
      await adminApi('saveMainSettings', { data: { supportContactEmail: email, supportContactPhone: phone } });
      supportContactDirtyRef.current = false;
      setSupportContactMsg({ type: 'success', text: 'Support contact details saved. They are now shown on the public Support and Privacy pages.' });
    } catch (e) {
      setSupportContactMsg({ type: 'error', text: e.message || 'Could not save support contact details.' });
    }
  };

 // ===================== PHOTO SELECT (JPG/JPEG only, passport size) =====================
  const handlePhotoSelect = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!ALLOWED_PHOTO_TYPES.includes(f.type)) {
      alert('Only JPG or JPEG files are allowed. Please select a passport photo in JPG format.');
      e.target.value = '';
      setPhoto(null); setPhotoPreview(''); setOversizedFile(null);
      return;
    }
    if (f.size > MAX_PHOTO_KB * 1024) {
      setOversizedFile(f);
      setPhoto(null);
      setPhotoPreview('');
      return;
    }
    setOversizedFile(null);
    setPhoto(f);
    setPhotoPreview(URL.createObjectURL(f));
  };

  const handleAutoCompress = async () => {
    if (!oversizedFile) return;
    setCompressing(true);
    try {
      const compressed = await compressImage(oversizedFile, 499);
      setPhoto(compressed);
      setPhotoPreview(URL.createObjectURL(compressed));
      setOversizedFile(null);
    } catch (err) {
      alert('Could not auto-compress photo: ' + err.message);
    } finally {
      setCompressing(false);
    }
  };

  const handleSaveCandidate = async () => {
    if (!name || !position || !dept) { alert('Name, position and dept required'); return; }
    if (photo && (!ALLOWED_PHOTO_TYPES.includes(photo.type) || photo.size > MAX_PHOTO_KB * 1024)) {
      alert(`Photo must be JPG/JPEG and under ${MAX_PHOTO_KB}KB (passport photo size).`);
      return;
    }
    try {
      if (editingCandidate) {
        await adminApi('saveCandidate', { id: editingCandidate.id, data: { name, position, dept, manifesto } });
        // Upload photo if a new one was selected (Cloudinary — signature from /api/upload)
        if (photo) {
          const photoURL = await uploadPhotoToCloudinary(photo);
          await adminApi('saveCandidate', { id: editingCandidate.id, data: { photo: photoURL, photoURL } });
        }
      } else {
        const posCount = candidates.filter(c => c.position === position).length;
        if (posCount >= MAX_PER_POSITION) { alert(`Max ${MAX_PER_POSITION} for ${position}`); return; }
        let photoURL = '';
        if (photo) {
          photoURL = await uploadPhotoToCloudinary(photo);
        }
        await adminApi('saveCandidate', {
          data: { name, position, dept, votes: 0, photo: photoURL, photoURL, manifesto }
        });
      }
      setName(''); setPosition(''); setDept(''); setManifesto('');
      setPhoto(null); setPhotoPreview(''); setOversizedFile(null); setEditingCandidate(null);
      loadAllData();
    } catch (e) { alert('Error: ' + e.message); }
  };

  const handleEditCandidate = (c) => {
    setEditingCandidate(c);
    setName(c.name); setPosition(c.position); setDept(c.dept);
    setManifesto(c.manifesto || '');
    setPhotoPreview(c.photo || '');
    setPhoto(null);
    setOversizedFile(null);
  };

  const handleDeleteCandidate = async (id) => {
    if (!window.confirm('Delete?')) return;
    try { await adminApi('deleteCandidate', { id }); loadAllData(); }
    catch (e) { alert('Error: ' + e.message); }
  };

  const handleGenerateResults = async () => {
    if (candidates.length === 0) {
      setPrintMsg('No candidates to generate results for.');
      return;
    }
    setPrintLoading(true);
    setPrintMsg('Generating results...');
    setResultsGenerated(false);

    try {
      // Check if results already exist (electionData is denied client-side — read via server)
      const existingResultsRes = await adminApi('getResults');
      let storedCandidateIds = {};

      if (existingResultsRes.data) {
        storedCandidateIds = existingResultsRes.data.candidateIds || {};
      }

      // Count candidates per position for vote points
      const positionCounts = {};
      candidates.forEach(c => {
        positionCounts[c.position] = (positionCounts[c.position] || 0) + 1;
      });

      // Build results array
      const results = [];
      const candidateIds = { ...storedCandidateIds };

      candidates.forEach((c, index) => {
        // Generate candidate ID if not already stored
        if (!candidateIds[c.id]) {
          candidateIds[c.id] = generateCandidateId();
        }

        const totalInPosition = positionCounts[c.position] || 1;
        const votes = c.votes || 0;
        const votePoint = totalInPosition > 0 ? (votes / totalInPosition).toFixed(2) : '0.00';

        results.push({
          sNo: index + 1,
          candidateId: candidateIds[c.id],
          name: c.name,
          position: c.position,
          votes: votes,
          votePoint: votePoint,
          dept: c.dept || ''
        });
      });

      // Sort by position then by votes descending
      results.sort((a, b) => {
        if (a.position !== b.position) return a.position.localeCompare(b.position);
        return b.votes - a.votes;
      });

      // Re-assign serial numbers after sorting
      results.forEach((r, i) => { r.sNo = i + 1; });

      // Store in Firestore (server-side)
      const year = settings.year || '2026/2027';
      await adminApi('saveResults', {
        data: {
          year: year,
          generatedAt: new Date().toISOString(),
          candidateIds: candidateIds,
          results: results,
          totalPositions: Object.keys(positionCounts).length,
          totalCandidates: candidates.length,
          totalVoters: activeVoters
        }
      });

      setElectionResults(results);
      setResultsGenerated(true);
      setPrintMsg(`✅ Results generated and saved! ${results.length} candidates.`);
      setTimeout(() => setPrintMsg(''), 4000);
    } catch (e) {
      setPrintMsg('❌ Error: ' + e.message);
    }
    setPrintLoading(false);
  };

  // Load existing results when entering print view
  const loadExistingResults = async () => {
    setPrintLoading(true);
    try {
      const resultsRes = await adminApi('getResults');
      // Also clears old printable results when electionData/results is deleted.
      applyStoredResults(resultsRes.data, candidates);
    } catch (e) {
      console.error('Load results error:', e);
    }
    setPrintLoading(false);
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#fff', fontFamily: 'Arial, sans-serif', paddingBottom: '40px' }}>
        {/* Top bar skeleton (navy strip, like the real admin header) */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 24px', background: '#341D61',
        }}>
          <SkeletonBox style={{ height: '24px', width: '210px' }} />
          <SkeletonBox style={{ height: '34px', width: '100px', borderRadius: '17px' }} />
        </div>

        <div style={{ padding: '24px 20px 0', maxWidth: '1150px', margin: '0 auto' }}>
          {/* The four dashboard stat cards */}
          <StatsGridSkeleton count={4} />

          {/* Candidates overview list skeleton */}
          <div style={{
            marginTop: '22px', background: 'white', border: '1px solid #e8ecf0',
            borderRadius: '12px', padding: '18px',
          }}>
            <SkeletonBox style={{ height: '16px', width: '230px', marginBottom: '16px' }} />
            {[0, 1, 2, 3].map((row) => (
              <div key={row} style={{ display: 'flex', gap: '14px', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f0f2f5' }}>
                <SkeletonBox style={{ height: '38px', width: '38px', borderRadius: '50%' }} />
                <SkeletonBox style={{ height: '14px', flex: 2 }} />
                <SkeletonBox style={{ height: '14px', width: '70px' }} />
                <SkeletonBox style={{ height: '26px', width: '84px', borderRadius: '13px' }} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#341D61', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'Arial, sans-serif', padding: '20px' }}>
        <h2 style={{ color: '#ef4444' }}>ERROR</h2>
        <p style={{ color: 'white', textAlign: 'center', maxWidth: '500px' }}>{error}</p>
        <p style={{ color: '#ddd6e8', fontSize: '14px', maxWidth: 520, textAlign: 'center' }}>Confirm Firebase Admin credentials are configured on Vercel and deploy this project's restrictive Firestore rules. Do not enable Test Mode or publish permissive rules.</p>
        <button onClick={loadAllData} style={{ padding: '10px 24px', background: '#e6def2', color: '#341D61', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', marginTop: '16px' }}>Retry</button>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#fff', fontFamily: 'Arial, sans-serif' }}>
      {/* Sidebar overlay */}
      {sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', zIndex: 40 }} />}

      {/* Sidebar */}
      <div style={{
        position: 'fixed', top: 0, left: 0, bottom: 0, width: '250px',
        background: '#341D61', zIndex: 50, padding: '20px 16px',
        transform: sidebarOpen ? 'translateX(0)' : 'translateX(-260px)',
        transition: 'transform 0.3s ease', overflowY: 'auto'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h3 style={{ color: '#e6def2', margin: 0 }}>SMCOAA Admin</h3>
          <button onClick={() => setSidebarOpen(false)} style={{ background: 'none', border: 'none', color: '#e6def2', fontSize: '24px', cursor: 'pointer', padding: 0 }}>×</button>
        </div>
        {sidebarItems.map(item => (
          <div key={item.key} onClick={() => { setActiveView(item.key); setSidebarOpen(false); if (item.key === 'print-results') loadExistingResults(); }}
               style={{
                 display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px',
                 marginBottom: '4px', borderRadius: '8px', cursor: 'pointer',
                 background: activeView === item.key ? 'rgba(230,222,242,0.18)' : 'transparent',
                 color: activeView === item.key ? '#e6def2' : 'rgba(255,255,255,0.8)',
                 fontWeight: activeView === item.key ? 'bold' : 'normal'
               }}>
            <span>{item.icon}</span>
            <span>{item.label}</span>
          </div>
        ))}
        {/* FIXED: Logout now clears the session token */}
        <button onClick={() => { localStorage.removeItem('smcoaa_adminToken'); navigate('/admin-login'); }}
                style={{ width: '100%', padding: '12px', marginTop: '20px', background: 'rgba(255,255,255,0.1)', color: 'white', border: '1px solid rgba(255,255,255,0.2)', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' }}>
          Logout
        </button>
      </div>

      {/* Main */}
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px' }}>
        {/* Header */}
        <div style={{ background: '#341D61', borderRadius: '12px', padding: '16px 24px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'white' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button onClick={() => setSidebarOpen(true)}
                    style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', width: '40px', height: '40px', borderRadius: '8px', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
              <span style={{ display: 'block', width: '18px', height: '2px', background: '#e6def2' }}></span>
              <span style={{ display: 'block', width: '18px', height: '2px', background: '#e6def2' }}></span>
              <span style={{ display: 'block', width: '18px', height: '2px', background: '#e6def2' }}></span>
            </button>
            <div>
              <h2 style={{ margin: 0, color: '#e6def2' }}>Admin Dashboard</h2>
              <span style={{ fontSize: '12px', opacity: 0.8 }}>BROUTE</span>
            </div>
          </div>
        </div>

        {/* Dashboard */}
        {activeView === 'dashboard' && (
          <>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
              <div style={statCardStyle}>
                <div style={{ fontSize: '28px', marginBottom: '8px' }}>👥</div>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#341D61' }}>{candidates.length}</div>
                <div style={{ fontSize: '13px', color: '#666' }}>Candidates</div>
              </div>
              <div style={statCardStyle}>
                <div style={{ fontSize: '28px', marginBottom: '8px' }}>🗳️</div>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#341D61' }}>{activeVoters}</div>
                <div style={{ fontSize: '13px', color: '#666' }}>Votes Cast</div>
              </div>
              <div style={statCardStyle}>
                <div style={{ fontSize: '28px', marginBottom: '8px' }}>📋</div>
                <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#341D61' }}>{Object.keys(candidates.reduce((acc, c) => { acc[c.position] = true; return acc; }, {})).length}</div>
                <div style={{ fontSize: '13px', color: '#666' }}>Positions</div>
              </div>
            </div>
            <div style={cardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ color: '#341D61', margin: 0 }}>Quick Actions</h3>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ fontSize: '13px', color: '#666' }}>Mode:</span>
                  <span style={{
                    padding: '4px 12px', borderRadius: '12px', fontSize: '13px', fontWeight: 'bold',
                    background: activeMode === 'none' ? '#fee2e2' : '#d1fae5',
                    color: activeMode === 'none' ? '#dc2626' : '#16a34a'
                  }}>
                    {activeMode === 'none' && '○ Inactive'}
                    {activeMode === 'election' && '● Election'}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <button onClick={() => setActiveView('settings')} style={btnPrimary}>⚙️ Settings</button>
                <button onClick={() => setActiveView('candidates')} style={{ ...btnPrimary, background: '#50347B' }}>👥 Candidates</button>
                <button onClick={() => setActiveView('activation')} style={{ ...btnPrimary, background: '#8b5cf6' }}>🔘 Activation</button>
                <button onClick={() => setActiveView('results')} style={{ ...btnPrimary, background: '#16a34a' }}>📈 Results</button>
              </div>
            </div>
          </>
        )}

        {/* Settings */}
        {activeView === 'settings' && (
          <div style={cardStyle}>
            <h2 style={{ color: '#341D61', marginBottom: '16px' }}>⚙️ Election Settings</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
              <div>
                <label style={{ fontSize: '14px', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>Year</label>
                <input value={settings.year} onChange={e => { settingsDirtyRef.current = true; setSettings({...settings, year: e.target.value}); }} style={inputStyle} placeholder="2026/2027" />
              </div>
              <div>
                <label style={{ fontSize: '14px', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>Active</label>
                <select value={settings.isActive ? 'true' : 'false'} onChange={e => { settingsDirtyRef.current = true; setSettings({...settings, isActive: e.target.value === 'true'}); }} style={inputStyle}>
                  <option value="false">Disabled</option>
                  <option value="true">Active</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: '14px', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>Start Date</label>
                <input type="date" value={settings.startDate} onChange={e => { settingsDirtyRef.current = true; setSettings({...settings, startDate: e.target.value}); }} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: '14px', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>Start Time</label>
                <input type="time" value={settings.startTime} onChange={e => { settingsDirtyRef.current = true; setSettings({...settings, startTime: e.target.value}); }} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: '14px', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>End Date</label>
                <input type="date" value={settings.endDate} onChange={e => { settingsDirtyRef.current = true; setSettings({...settings, endDate: e.target.value}); }} style={inputStyle} />
              </div>
              <div>
                <label style={{ fontSize: '14px', fontWeight: 'bold', display: 'block', marginBottom: '4px' }}>End Time</label>
                <input type="time" value={settings.endTime} onChange={e => { settingsDirtyRef.current = true; setSettings({...settings, endTime: e.target.value}); }} style={inputStyle} />
              </div>
            </div>
            <button onClick={handleSaveSettings} style={{ ...btnPrimary, marginTop: '16px' }}>💾 Save</button>
          </div>
        )}

        {activeView === 'settings' && (
          <div style={cardStyle}>
            <h2 style={{ color: '#341D61', marginBottom: 8 }}>📨 Official Support Contact</h2>
            <p style={{ color: '#666', fontSize: 14, marginTop: 0 }}>Add the email address (including Yahoo) and/or phone number that voters should use for complaints and support replies. You can leave either field blank and update them later.</p>
            <label htmlFor="support-contact-email" style={labelStyle}>Support email</label>
            <input id="support-contact-email" type="email" maxLength={254} value={supportContact.email} onChange={e => { supportContactDirtyRef.current = true; setSupportContact({ ...supportContact, email: e.target.value }); }} style={inputStyle} placeholder="association@yahoo.com" />
            <label htmlFor="support-contact-phone" style={labelStyle}>Support phone number</label>
            <input id="support-contact-phone" type="tel" maxLength={32} value={supportContact.phone} onChange={e => { supportContactDirtyRef.current = true; setSupportContact({ ...supportContact, phone: e.target.value }); }} style={inputStyle} placeholder="+234…" />
            <button onClick={handleSaveSupportContact} style={btnPrimary}>💾 Save Support Contact</button>
            {supportContactMsg.text && <div role="status" style={{ marginTop: 12, color: supportContactMsg.type === 'error' ? '#b91c1c' : '#166534', fontWeight: 700 }}>{supportContactMsg.text}</div>}
          </div>
        )}

        {activeView === 'member-lookup' && (
          <div style={cardStyle}>
            <h2 style={{ color: '#341D61', marginBottom: 8 }}>🔎 Find Member S/N</h2>
            <p style={{ color: '#666', fontSize: 14 }}>Admin-only lookup in the fixed membership roll. Enter a member's name; matching name, set, and S/N will appear. This does not create or edit member records.</p>
            <form onSubmit={handleFindMemberSn} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <input value={memberNameQuery} onChange={e => setMemberNameQuery(e.target.value)} maxLength={100} minLength={3} required style={{ ...inputStyle, flex: '1 1 260px', marginBottom: 0 }} placeholder="Enter member name" aria-label="Member name to search" />
              <button type="submit" disabled={memberLookupBusy || memberNameQuery.trim().length < 3} style={{ ...btnPrimary, opacity: memberLookupBusy ? 0.65 : 1 }}>{memberLookupBusy ? 'Searching…' : 'Find S/N'}</button>
            </form>
            {memberLookupMsg && <p role="status" style={{ color: '#6b6472', marginTop: 14 }}>{memberLookupMsg}</p>}
            {memberLookupResults.length > 0 && <div style={{ marginTop: 16, overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}><thead><tr>{['Name', 'Set', 'S/N', 'Sex'].map(label => <th key={label} style={{ padding: 10, background: '#f4f0fa', color: '#341D61' }}>{label}</th>)}</tr></thead><tbody>{memberLookupResults.map((member, index) => <tr key={`${member.set}-${member.sn}-${index}`}><td style={{ padding: 10, borderBottom: '1px solid #eee' }}>{member.name}</td><td style={{ padding: 10, borderBottom: '1px solid #eee' }}>{member.set}</td><td style={{ padding: 10, borderBottom: '1px solid #eee', fontWeight: 700 }}>{member.sn}</td><td style={{ padding: 10, borderBottom: '1px solid #eee' }}>{member.sex || '—'}</td></tr>)}</tbody></table></div>}
          </div>
        )}

        {activeView === 'voter-roll' && (
          <div style={cardStyle}>
            <h2 style={{ color: '#341D61', marginBottom: 8 }}>📥 Voter Roll Import</h2>
            <p style={{ color: '#555', lineHeight: 1.55 }}>
              Add the existing fixed roll or later members through this Admin-only server API. Imports are add-only: existing member documents are skipped, never overwritten or deleted, and their <code>hasVoted</code> state is never changed. Every imported record starts with <code>hasVoted: false</code>.
            </p>
            <div style={{ background: '#f4f0fa', border: '1px solid #e5e1ec', borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <strong style={{ color: '#341D61' }}>Step 1 · Load current fixed voter roll</strong>
              <p style={{ margin: '6px 0 12px', color: '#5b5663', fontSize: 14 }}>This adds only missing records from the project’s fixed roll. It is safe to retry; existing records and votes are preserved.</p>
              <button onClick={seedFixedRoster} disabled={rosterBusy} style={{ ...btnPrimary, opacity: rosterBusy ? 0.65 : 1 }}>{rosterBusy ? 'Working…' : 'Load missing fixed-roll members'}</button>
            </div>
            <div style={{ border: '1px solid #e5e1ec', borderRadius: 10, padding: 14 }}>
              <strong style={{ color: '#341D61' }}>Step 2 · Add future members from CSV</strong>
              <p style={{ margin: '6px 0 12px', color: '#5b5663', fontSize: 14 }}>CSV headers must be <code>Set,S/N,Name,Sex</code>. Allowed Sex values: Male, Female, Not specified, Prefer not to say. Maximum 1,000 rows and 1 MB per import.</p>
              <a href={`data:text/csv;charset=utf-8,${encodeURIComponent('Set,S/N,Name,Sex\n2026,1,Example Member,Male\n')}`} download="SMCOAA-member-import-template.csv" style={{ color: '#341D61', fontWeight: 700 }}>Download CSV template</a>
              <label htmlFor="member-roster-csv" style={{ display: 'block', marginTop: 14, marginBottom: 8, fontWeight: 700, color: '#332b3e' }}>Choose a member CSV file</label>
              <input id="member-roster-csv" type="file" accept=".csv,text/csv" disabled={rosterBusy} onChange={e => previewRosterCsv(e.target.files?.[0])} />
              {rosterPreview && <p style={{ color: '#332b3e', margin: '12px 0' }}>Preview: {rosterPreview.total} valid row(s); {rosterPreview.toCreate} new; {rosterPreview.alreadyPresent} existing Set/S/N IDs will be skipped.</p>}
              <button onClick={importRosterCsv} disabled={rosterBusy || !rosterPreview || rosterPreview.toCreate < 1} style={{ ...btnPrimary, marginTop: 12, opacity: rosterBusy || !rosterPreview || rosterPreview.toCreate < 1 ? 0.55 : 1 }}>{rosterBusy ? 'Working…' : 'Confirm and add new members'}</button>
            </div>
            {rosterMessage.text && <div role="status" style={{ marginTop: 14, padding: 12, borderRadius: 8, background: rosterMessage.type === 'error' ? '#fee2e2' : '#ecfdf3', color: rosterMessage.type === 'error' ? '#b91c1c' : '#166534', fontWeight: 700 }}>{rosterMessage.text}</div>}
            <p style={{ color: '#6b6472', fontSize: 13, marginTop: 16 }}>Firestore remains deny-all for browser clients. The server validates every row and writes through Firebase Admin; members are not loaded into the browser bundle.</p>
          </div>
        )}

        {/* ===================== ACTIVATION VIEW ===================== */}
        {activeView === 'activation' && (
          <div>
            

            <div style={cardStyle}>
              <h2 style={{ color: '#341D61', marginBottom: '8px' }}>🔘 Activation Control</h2>
              <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
                Control when voter access and ballot submission are available.
                {activeMode !== 'none' && (
                  <span style={{ display: 'block', marginTop: '8px', fontSize: '13px', color: '#50347B', background: '#eee9f5', padding: '8px 12px', borderRadius: '6px' }}>
                    ⏰ Auto-stop enabled: When end date/time passes, it stops automatically.
                  </span>
                )}
              </p>

              {activationMsg.text && (
                <div style={{
                  padding: '12px 16px', borderRadius: '8px', marginBottom: '16px', fontWeight: 'bold',
                  background: activationMsg.type === 'error' ? '#fee2e2' : '#d1fae5',
                  color: activationMsg.type === 'error' ? '#dc2626' : '#16a34a'
                }}>
                  {activationMsg.text}
                </div>
              )}

              <div style={{
                textAlign: 'center', padding: '16px', background: '#f8fafc', borderRadius: '8px',
                marginBottom: '24px'
              }}>
                <div style={{ fontSize: '13px', color: '#666', marginBottom: '4px' }}>Current Mode</div>
                <div style={{
                  padding: '8px 24px', borderRadius: '20px', fontWeight: 'bold', display: 'inline-block', fontSize: '16px',
                  background: activeMode === 'none' ? '#fee2e2' : '#d1fae5',
                  color: activeMode === 'none' ? '#dc2626' : '#16a34a'
                }}>
                  {activeMode === 'none' && '🔴 Nothing Active'}
                  {activeMode === 'election' && '🟢 Election Voting Active'}
                </div>
              </div>
            </div>

            {/* Election Card */}
            <div style={cardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
                <div style={{
                  width: '48px', height: '48px', borderRadius: '12px', background: '#341D61',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px'
                }}>🗳️</div>
                <div style={{ flex: 1 }}>
                  <h3 style={{ margin: '0 0 2px 0', color: '#341D61' }}>Election</h3>
                  <p style={{ margin: 0, color: '#666', fontSize: '13px' }}>
                    {activeMode === 'election' || activeMode === 'both'
                      ? 'Voting is LIVE for members'
                      : 'Voters cannot vote right now'}
                  </p>
                  {settings.endDate && settings.endTime && (
                    <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#888' }}>
                      Auto-stops: {settings.endDate} at {settings.endTime}
                    </p>
                  )}
                </div>
                <div style={{
                  padding: '6px 16px', borderRadius: '20px', fontWeight: 'bold', fontSize: '14px',
                  background: (activeMode === 'election' || activeMode === 'both') ? '#d1fae5' : '#fee2e2',
                  color: (activeMode === 'election' || activeMode === 'both') ? '#16a34a' : '#dc2626'
                }}>
                  {(activeMode === 'election' || activeMode === 'both') ? '● LIVE' : '○ OFF'}
                </div>
              </div>

              <div style={{
                padding: '12px 16px', background: '#f8fafc', borderRadius: '8px', marginBottom: '20px',
                fontSize: '13px', color: '#666'
              }}>
                <strong>Prerequisites:</strong>
                <span style={{ marginLeft: '8px' }}>
                  {candidates.length === 0 ? (
                    <span style={{ color: '#dc2626' }}>❌ No candidates</span>
                  ) : (
                    <span style={{ color: '#16a34a' }}>✅ {candidates.length} candidates</span>
                  )}
                </span>
                <span style={{ margin: '0 12px' }}>|</span>
                <span>
                  {!settings.startDate || !settings.endDate ? (
                    <span style={{ color: '#dc2626' }}>❌ Dates not set</span>
                  ) : (
                    <span style={{ color: '#16a34a' }}>✅ Dates configured</span>
                  )}
                </span>
              </div>

              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => handleActivate('election')}
                  disabled={activationLoading || (activeMode === 'election' || activeMode === 'both') || candidates.length === 0}
                  style={{
                    ...btnSuccess,
                    opacity: (activationLoading || (activeMode === 'election' || activeMode === 'both') || candidates.length === 0) ? 0.5 : 1,
                    cursor: (activationLoading || (activeMode === 'election' || activeMode === 'both') || candidates.length === 0) ? 'not-allowed' : 'pointer',
                    padding: '14px 32px', fontSize: '15px'
                  }}
                >
                  {activationLoading ? '⏳...' : '🔘 Activate'}
                </button>
                <button
                  onClick={() => handleToggleStop('election')}
                  disabled={activationLoading || !(activeMode === 'election' || activeMode === 'both')}
                  style={{
                    ...btnDanger,
                    opacity: (activationLoading || !(activeMode === 'election' || activeMode === 'both')) ? 0.5 : 1,
                    cursor: (activationLoading || !(activeMode === 'election' || activeMode === 'both')) ? 'not-allowed' : 'pointer',
                    padding: '14px 32px', fontSize: '15px'
                  }}
                >
                  {activationLoading ? '⏳...' : '⏹️ Stop Election'}
                </button>
              </div>
            </div>

            
            
          </div>
        )}

        {/* Candidates */}
        {activeView === 'candidates' && (
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ color: '#341D61', margin: 0 }}>👥 Manage Candidates</h2>
              <span style={{ fontSize: '12px', color: '#888' }}>{candidates.length} total candidates</span>
            </div>
            <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '8px', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 12px 0', color: '#341D61' }}>{editingCandidate ? '✏️ Edit Candidate (Add photo & manifesto)' : '➕ Add Candidate Manually'}</h3>
              <input placeholder="Full Name" value={name} onChange={e => setName(e.target.value)} style={inputStyle} />
              <input placeholder="Position" value={position} onChange={e => setPosition(e.target.value)} style={inputStyle} />
              <input placeholder="Department" value={dept} onChange={e => setDept(e.target.value)} style={inputStyle} />
              <textarea placeholder="Candidate manifesto (optional)" value={manifesto} onChange={e => setManifesto(e.target.value)} style={{...inputStyle, minHeight: '80px'}} />
          <label style={labelStyle}>Candidate Photo (JPG/JPEG, max 500KB):</label>
              <input
                type="file"
                accept=".jpg,.jpeg,image/jpeg"
                onChange={handlePhotoSelect}
                style={{ marginBottom: '8px', display: 'block' }}
              />

              {/* ⚠️ Oversized Notice + ⚡ High-Precision Auto-Size Button */}
              {oversizedFile && (
                <div style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  padding: '12px 16px',
                  margin: '10px 0',
                  fontSize: '13px'
                }}>
                  <div style={{ color: '#dc2626', fontWeight: 'bold', marginBottom: '4px' }}>
                    ⚠️ Photo is too large: {(oversizedFile.size / 1024).toFixed(0)} KB (Maximum allowed is {MAX_PHOTO_KB} KB)
                  </div>
                  <p style={{ color: '#64748b', margin: '0 0 8px 0', fontSize: '12px' }}>
                    Click below to automatically optimize this photo to ~499 KB while preserving 100% full aspect ratio and image clarity without any cutting:
                  </p>
                  <button
                    type="button"
                    onClick={handleAutoCompress}
                    disabled={compressing}
                    style={{
                      ...btnPrimary,
                      background: '#50347B',
                      padding: '8px 16px',
                      fontSize: '13px',
                      cursor: compressing ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {compressing ? '⏳ Auto-sizing photo...' : '⚡ Click to Auto-Size Photo (<500 KB)'}
                  </button>
                </div>
              )}

              {photo && photoPreview && (
                <div style={{ margin: '10px 0' }}>
                  <div style={{ fontSize: '13px', color: '#15803d', background: '#dcfce7', padding: '6px 12px', borderRadius: '6px', marginBottom: '8px', display: 'inline-block' }}>
                    ✅ Ready: {photo.name} ({(photo.size / 1024).toFixed(0)} KB)
                  </div>
                  <div>
                    <img src={photoPreview} alt="" style={{ width: '80px', height: '80px', borderRadius: '8px', objectFit: 'cover', border: '1px solid #cbd5e1', display: 'block' }} />
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button onClick={handleSaveCandidate} style={btnSuccess}>{editingCandidate ? '✏️ Update' : '➕ Add'}</button>
                {editingCandidate && <button onClick={() => { setEditingCandidate(null); setName(''); setPosition(''); setDept(''); setManifesto(''); setPhoto(null); setPhotoPreview(''); setOversizedFile(null); }} style={btnDanger}>Cancel</button>}
              </div>
            </div>
            {candidates.length === 0 ? <p style={{ color: '#999', textAlign: 'center' }}>No candidates yet</p> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#341D61', color: 'white' }}>
                      <th style={{ padding: '12px', textAlign: 'left' }}>#</th>
                      <th style={{ padding: '12px', textAlign: 'left' }}>Name</th>
                      <th style={{ padding: '12px', textAlign: 'left' }}>Position</th>
                      <th style={{ padding: '12px', textAlign: 'center' }}>Votes</th>
                                            <th style={{ padding: '12px', textAlign: 'center' }}>Photo</th>
                      <th style={{ padding: '12px', textAlign: 'center' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c, i) => (
                      <tr key={c.id} style={{ borderBottom: '1px solid #eee' }}>
                        <td style={{ padding: '12px' }}>{i+1}</td>
                        <td style={{ padding: '12px', fontWeight: 'bold' }}>{c.name}</td>
                        <td style={{ padding: '12px', color: '#666' }}>{c.position}</td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>{c.votes || 0}</td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          {c.photo ? (
                            <img src={c.photo} alt="" style={{ width: '32px', height: '32px', borderRadius: '50%', objectFit: 'cover' }} />
                          ) : (
                            <span style={{ color: '#dc2626', fontSize: '12px' }}>❌ No photo</span>
                          )}
                        </td>
                        <td style={{ padding: '12px', textAlign: 'center' }}>
                          <button onClick={() => handleEditCandidate(c)} style={{ padding: '6px 14px', background: '#50347B', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', marginRight: '8px', fontSize: '13px' }}>Edit</button>
                          <button onClick={() => handleDeleteCandidate(c.id)} style={{ padding: '6px 14px', background: '#dc2626', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Del</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Results */}
        {activeView === 'results' && (
          <div style={cardStyle}>
            <h2 style={{ color: '#341D61', marginBottom: '16px' }}>📈 Election Results</h2>
            {activeMode === 'election' || activeMode === 'both' ? (
              <p style={{ color: '#f59e0b', background: '#fef3c7', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontWeight: 'bold' }}>
                ⏳ Election is still active. Results will auto-appear once election ends.
              </p>
            ) : (
              candidates.length > 0 && (
                <p style={{ color: '#16a34a', background: '#d1fae5', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontWeight: 'bold' }}>
                  ✅ Election ended — final results displayed below.
                </p>
              )
            )}
            {candidates.length === 0 ? <p style={{ color: '#999', textAlign: 'center' }}>No candidates yet</p> : (
              <>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ background: '#341D61', color: 'white' }}>
                      <th style={{ padding: '12px' }}>Position</th>
                      <th style={{ padding: '12px' }}>Rank</th>
                      <th style={{ padding: '12px' }}>Candidate</th>
                      <th style={{ padding: '12px', textAlign: 'center' }}>Votes</th>
                    </tr></thead>
                    <tbody>
                      {sortedByVotes.map((c, idx) => (
                        <tr key={c.id} style={{ borderBottom: '1px solid #eee' }}>
                          <td style={{ padding: '12px', color: '#666', fontSize: '13px' }}>{c.position}</td>
                          <td style={{ padding: '12px', fontSize: '18px', fontWeight: 'bold', color: idx === 0 ? '#e6def2' : idx === 1 ? '#94a3b8' : idx === 2 ? '#cd7f32' : '#341D61' }}>{idx+1}</td>
                          <td style={{ padding: '12px', fontWeight: 'bold' }}>{c.name}</td>
                          <td style={{ padding: '12px', textAlign: 'center', fontWeight: 'bold', fontSize: '18px' }}>{c.votes || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button onClick={() => window.print()} style={{ ...btnPrimary, marginTop: '16px' }}>🖨️ Print</button>
              </>
            )}
          </div>
        )}

        {/* ===================== PRINT RESULTS VIEW ===================== */}
        {activeView === 'print-results' && (
          <div>
            <div style={cardStyle}>
              <h2 style={{ color: '#341D61', marginBottom: '8px' }}>🖨️ Print Election Results</h2>
              <p style={{ color: '#666', fontSize: '13px', marginBottom: '16px' }}>
                Generate and print official election results. Results include auto-generated Candidate IDs and Vote Points.
              </p>
              {printMsg && (
                <div style={{
                  padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', fontWeight: 'bold',
                  background: printMsg.includes('Error') ? '#fee2e2' : '#d1fae5',
                  color: printMsg.includes('Error') ? '#dc2626' : '#16a34a'
                }}>
                  {printMsg}
                </div>
              )}
              {!resultsGenerated ? (
                <div style={{ textAlign: 'center', padding: '20px' }}>
                  <p style={{ color: '#888', marginBottom: '16px' }}>
                    {candidates.length === 0
                      ? 'No candidates available to generate results.'
                      : `Click below to generate official results for ${candidates.length} candidates across ${Object.keys(candidates.reduce((acc, c) => { acc[c.position] = true; return acc; }, {})).length} positions.`}
                  </p>
                  <button
                    onClick={handleGenerateResults}
                    disabled={printLoading || candidates.length === 0}
                    style={{
                      ...btnPrimary, background: printLoading ? '#999' : '#16a34a',
                      padding: '14px 40px', fontSize: '16px',
                      opacity: (printLoading || candidates.length === 0) ? 0.5 : 1,
                      cursor: (printLoading || candidates.length === 0) ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {printLoading ? '⏳ Generating...' : '📊 Generate Results'}
                  </button>
                </div>
              ) : (
                <div style={{ textAlign: 'center', marginBottom: '16px' }}>
                  <button
                    onClick={() => window.print()}
                    style={{ ...btnPrimary, background: '#50347B', padding: '14px 40px', fontSize: '16px' }}
                  >
                    🖨️ Print / Download PDF
                  </button>
                  <button
                    onClick={() => { setResultsGenerated(false); setElectionResults([]); }}
                    style={{ ...btnDanger, marginLeft: '12px', padding: '14px 24px', fontSize: '14px' }}
                  >
                    Regenerate
                  </button>
                </div>
              )}
            </div>

            {/* Printable Results Document */}
            {resultsGenerated && electionResults.length > 0 && (
              <div id="printableResults">
                <style>{`
                  @media print {
                    body * { visibility: hidden; }
                    #printableResults, #printableResults * { visibility: visible; }
                    #printableResults { position: absolute; left: 0; top: 0; width: 100%; margin: 0; padding: 0; }
                    @page { margin: 15mm; size: A4 portrait; }
                  }
                `}</style>
                <div style={{
                  background: '#341D61',
                  padding: '40px 20px',
                  borderRadius: '12px',
                  fontFamily: 'Arial, sans-serif'
                }}>
                  <div style={{
                    background: 'white',
                    maxWidth: '900px',
                    margin: '0 auto',
                    padding: '40px 35px',
                    borderRadius: '8px',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.15)'
                  }}>
                    {/* Logo */}
                    <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                      <img
                        src="/logo.png"
                        alt="SMCOAA Logo"
                        style={{ width: '90px', height: '90px', borderRadius: '50%', objectFit: 'cover', border: '4px solid #e6def2', display: 'block', margin: '0 auto' }}
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    </div>

                    {/* Header */}
                    <h1 style={{
                      textAlign: 'center',
                      fontSize: '16px',
                      fontWeight: 'bold',
                      color: '#341D61',
                      margin: '0 0 4px 0',
                      lineHeight: '1.4',
                      textTransform: 'uppercase',
                      letterSpacing: '1px'
                    }}>
                      FEDERAL UNIVERSITY OF PETROLEUM RESOURCES EFFURUN
                    </h1>
                    <h2 style={{
                      textAlign: 'center',
                      fontSize: '15px',
                      fontWeight: 'bold',
                      color: '#341D61',
                      margin: '0 0 20px 0',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      SMCOAA VOTE RESULTS {settings.year ? `(${settings.year})` : ''}
                    </h2>

                    <hr style={{ border: '1px solid #341D61', marginBottom: '20px' }} />

                    {/* Results Table */}
                    <table style={{
                      width: '100%',
                      borderCollapse: 'collapse',
                      fontSize: '12px',
                      marginBottom: '20px'
                    }}>
                      <thead>
                        <tr style={{ background: '#341D61', color: 'white' }}>
                          <th style={{ padding: '10px 8px', border: '1px solid #341D61', textAlign: 'center', fontWeight: 'bold' }}>S/N</th>
                          <th style={{ padding: '10px 8px', border: '1px solid #341D61', textAlign: 'left', fontWeight: 'bold' }}>Candidate Name</th>
                          <th style={{ padding: '10px 8px', border: '1px solid #341D61', textAlign: 'left', fontWeight: 'bold' }}>Position</th>
                          <th style={{ padding: '10px 8px', border: '1px solid #341D61', textAlign: 'center', fontWeight: 'bold' }}>Votes</th>
                          <th style={{ padding: '10px 8px', border: '1px solid #341D61', textAlign: 'center', fontWeight: 'bold' }}>Vote Point</th>
                          <th style={{ padding: '10px 8px', border: '1px solid #341D61', textAlign: 'center', fontWeight: 'bold' }}>Candidate ID</th>
                        </tr>
                      </thead>
                      <tbody>
                        {electionResults.map((r, idx) => (
                          <tr key={idx} style={{
                            background: idx % 2 === 0 ? '#f8f9fa' : 'white',
                            borderBottom: '1px solid #dee2e6'
                          }}>
                            <td style={{ padding: '8px', border: '1px solid #dee2e6', textAlign: 'center', fontWeight: 'bold' }}>{r.sNo}</td>
                            <td style={{ padding: '8px', border: '1px solid #dee2e6', fontWeight: 'bold', color: '#341D61' }}>{r.name}</td>
                            <td style={{ padding: '8px', border: '1px solid #dee2e6', color: '#555' }}>{r.position}</td>
                            <td style={{ padding: '8px', border: '1px solid #dee2e6', textAlign: 'center', fontWeight: 'bold', color: '#16a34a' }}>{r.votes}</td>
                            <td style={{ padding: '8px', border: '1px solid #dee2e6', textAlign: 'center', fontWeight: 'bold', color: '#341D61' }}>{r.votePoint}</td>
                            <td style={{ padding: '8px', border: '1px solid #dee2e6', textAlign: 'center', fontFamily: 'monospace', fontSize: '11px', color: '#666' }}>{r.candidateId}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {/* Winners — one line per position, worked out from the table above.
                        The same position typed differently ("Asst. X " / "ASST. X") is ONE
                        position, so only the real winner is listed (src/utils/positions.js). */}
                    {(() => {
                      const winners = winnersByPosition(electionResults);
                      const th = { padding: '10px 8px', border: '1px solid #341D61', fontWeight: 'bold' };
                      const td = { padding: '8px', border: '1px solid #dee2e6' };
                      return (
                        <div data-testid="results-winners" style={{ marginBottom: '20px', pageBreakInside: 'avoid', breakInside: 'avoid' }}>
                          <h3 style={{ textAlign: 'center', fontSize: '14px', fontWeight: 'bold', color: '#341D61', margin: '0 0 10px 0', textTransform: 'uppercase', letterSpacing: '1px' }}>
                            Winners
                          </h3>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                            <thead>
                              <tr style={{ background: '#341D61', color: 'white' }}>
                                <th style={{ ...th, textAlign: 'center' }}>S/N</th>
                                <th style={{ ...th, textAlign: 'left' }}>Position</th>
                                <th style={{ ...th, textAlign: 'left' }}>Winner</th>
                                <th style={{ ...th, textAlign: 'center' }}>Votes</th>
                              </tr>
                            </thead>
                            <tbody>
                              {winners.map((w, idx) => (
                                <tr key={w.key} style={{ background: idx % 2 === 0 ? '#f8f9fa' : 'white', borderBottom: '1px solid #dee2e6' }}>
                                  <td style={{ ...td, textAlign: 'center', fontWeight: 'bold' }}>{idx + 1}</td>
                                  <td style={{ ...td, color: '#555' }}>{w.position}</td>
                                  <td style={{ ...td, fontWeight: 'bold', color: '#341D61' }}>{w.winner}</td>
                                  <td style={{ ...td, textAlign: 'center', fontWeight: 'bold', color: '#16a34a' }}>{w.votes}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      );
                    })()}

                    {/* Footer */}
                    <hr style={{ border: '1px solid #341D61', marginBottom: '12px' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#666' }}>
                      <span>Generated: {new Date().toLocaleDateString('en-GB')}</span>
                      <span>Total Candidates: {electionResults.length}</span>
                      <span>Academic Year: {settings.year || '2026/2027'}</span>
                    </div>

                    <div style={{ marginTop: '16px', fontSize: '11px', color: '#888', fontStyle: 'italic' }}>
                      <p style={{ margin: '2px 0' }}>Vote Point = Candidate's Votes ÷ Total Number of Candidates in that Position</p>
                    </div>

                    {/* Signature lines */}
                    <div style={{ marginTop: '40px', display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                      <div style={{ textAlign: 'center', width: '40%' }}>
                        <div style={{ borderTop: '1px solid #341D61', paddingTop: '6px', marginTop: '30px' }}>
                          Electoral Commission Chairman
                        </div>
                      </div>
                      <div style={{ textAlign: 'center', width: '40%' }}>
                        <div style={{ borderTop: '1px solid #341D61', paddingTop: '6px', marginTop: '30px' }}>
                          Departmental Representative
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        

        
        

        {/* Key Finder */}
        {activeView === 'super-admin' && (
          <div style={cardStyle}>
            <h2 style={{ color: '#341D61', marginBottom: '8px' }}>🛡️ Super Admin</h2>
            <p style={{ color: '#666', fontSize: '14px', marginBottom: '20px' }}>
              Live monitoring of pages, logins, votes, system health and maintenance recommendations.
              It can only be reached from here and needs the super admin login code.
            </p>

            <button
              onClick={() => navigate('/super-admin-login')}
              style={{ ...btnPrimary, marginBottom: '28px' }}
            >
              🚪 Open Super Admin Login
            </button>

            <h3 style={{ color: '#341D61', margin: '0 0 8px 0' }}>🔑 Set Super Admin Login Code</h3>
            <p style={{ color: '#666', fontSize: '13px', margin: '0 0 12px 0' }}>
              This code is checked against Firestore when you log in to the Super Admin Dashboard.
              Saving a new code immediately replaces the old one. Minimum 6 characters.
            </p>
            <input
              type="password"
              value={superCode}
              onChange={(e) => setSuperCode(e.target.value)}
              placeholder="Enter new super admin code"
              style={{ width: '100%', maxWidth: '380px', padding: '12px 14px', border: '1px solid #ddd', borderRadius: '8px', marginBottom: '12px', boxSizing: 'border-box', fontSize: '14px', fontFamily: 'monospace', outline: 'none' }}
            />
            <br />
            <button onClick={saveSuperCode} disabled={superCodeBusy}
              style={{ ...btnSuccess, opacity: superCodeBusy ? 0.6 : 1, cursor: superCodeBusy ? 'not-allowed' : 'pointer' }}>
              {superCodeBusy ? '⏳ Saving...' : '💾 Save Code'}
            </button>
            {superCodeMsg.text && (
              <div style={{ marginTop: '16px', padding: '10px 14px', borderRadius: '8px', fontWeight: 'bold', fontSize: '13px', background: superCodeMsg.type === 'error' ? '#fee2e2' : '#d1fae5', color: superCodeMsg.type === 'error' ? '#991b1b' : '#166534' }}>
                {superCodeMsg.text}
              </div>
            )}
          </div>
        )}

        

        {/* Messages */}
        {activeView === 'messages' && (
          <div style={cardStyle}>
            <h2 style={{ color: '#341D61', marginBottom: '16px' }}>✉️ Messages ({supportMessages.length})</h2>
            {supportMessages.length === 0 ? <p style={{ color: '#999', textAlign: 'center' }}>No messages</p> : (
              supportMessages.map(msg => (
                <div key={msg.id} style={{ padding: '16px', borderBottom: '1px solid #eee', background: msg.status === 'unread' ? '#eee9f5' : 'transparent' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                    <div>
                      <strong>{msg.name}</strong>
                      {msg.email && <span style={{ fontSize: '12px', color: '#888', marginLeft: '8px' }}>&lt;{msg.email}&gt;</span>}
                    </div>
                    <span style={{ fontSize: '12px', color: '#888' }}>
                      {msg.timestamp ? new Date(msg.timestamp).toLocaleString() : ''}
                      {msg.status === 'unread' && <span style={{ background: '#50347B', color: 'white', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', marginLeft: '8px' }}>New</span>}
                    </span>
                  </div>
                  <p style={{ margin: '0 0 4px 0', color: '#666' }}>{msg.message}</p>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {msg.status === 'unread' && (
                      <button onClick={async () => { try { await adminApi('markSupportRead', { id: msg.id }); loadAllData(); } catch(e) {} }}
                              style={{ padding: '4px 10px', background: 'transparent', color: '#50347B', border: '1px solid #50347B', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
                        Mark Read
                      </button>
                    )}
                    {msg.email && (
                      <a
                        href={`mailto:${msg.email}?subject=${encodeURIComponent('Re: SMCOAA Alumni Election Portal Support')}&body=${encodeURIComponent(
`${generateAutoReply(msg)}`
)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          padding: '4px 10px', background: '#ea4335', color: 'white',
                          border: 'none', borderRadius: '6px', cursor: 'pointer',
                          fontSize: '12px', fontWeight: 'bold', textDecoration: 'none'
                        }}
                      >
                        📧 Reply via Gmail
                      </a>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}