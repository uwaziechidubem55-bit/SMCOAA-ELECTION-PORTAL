// SMCOAA Alumni Election Portal
import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Link, Navigate, useLocation } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import SuperAdminRoute from './components/SuperAdminRoute';
import { PresenceProvider } from './context/PresenceContext';

// 👇 ONLY ADDITION — Import the install popup
import InstallPrompt from './components/InstallPrompt';

// ===== ADD THIS IMPORT =====
import ErrorBoundary from './components/ErrorBoundary';
import { PageSkeleton } from './components/Skeleton';

// ⚡ Dynamic/Lazy Imports for Page Components
const Landing = lazy(() => import('./pages/Landing'));
const StudentLogin = lazy(() => import('./pages/StudentLogin'));
const StudentDashboard = lazy(() => import('./pages/StudentDashboard'));
const AdminLogin = lazy(() => import('./pages/AdminLogin'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const Support = lazy(() => import('./pages/Support'));
const Privacy = lazy(() => import('./pages/Privacy'));
const Rules = lazy(() => import('./pages/Rules'));
const StaffLogin = lazy(() => import('./pages/StaffLogin'));
const StaffDashboard = lazy(() => import('./pages/StaffDashboard'));
const SuperAdminLogin = lazy(() => import('./pages/SuperAdminLogin'));
const SuperAdminDashboard = lazy(() => import('./pages/SuperAdminDashboard'));
const AuditVerificationDashboard = lazy(() => import('./pages/AuditVerificationDashboard'));

function LoadingScreen() {
  return (
    <div style={{ minHeight: '100vh', background: '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#341D61', fontFamily: 'Arial, sans-serif' }}>
      <svg width="180" height="150" viewBox="0 0 180 150" role="img" aria-label="Angel stepping on Satan loading illustration">
        <ellipse cx="93" cy="137" rx="54" ry="7" fill="#eee9f5" />
        <path d="M27 119c17-18 37 7 54-6 13-10 22 5 34-3 14-10 25 3 39-5" fill="none" stroke="#7b263a" strokeWidth="8" strokeLinecap="round" />
        <path d="M36 115l-12-10 14 2m112-14 14-11-5 17" fill="none" stroke="#7b263a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="119" cy="32" r="11" fill="#f2c9a5" />
        <path d="M108 29c2-13 21-15 24 0-7-5-16-5-24 0" fill="#50347b" />
        <path d="M111 46l-13 40 24 3 8-39" fill="#fff" stroke="#341D61" strokeWidth="3" />
        <path d="M105 50c-18-18-31-5-25 8 8-7 15-3 22 5m34-10c19-17 30-1 20 10-7-9-14-7-21 1" fill="#fff" stroke="#d8cce9" strokeWidth="4" strokeLinecap="round" />
        <path d="M102 86l-7 27 18 1 8-24m9-35 10 32 13-3-8-31" fill="none" stroke="#341D61" strokeWidth="8" strokeLinecap="round" />
        <path d="M90 115l20 2m26-33 14-3" fill="none" stroke="#f2c9a5" strokeWidth="6" strokeLinecap="round" />
        <path d="M87 24h64" stroke="#d8cce9" strokeWidth="2" strokeDasharray="3 5" />
      </svg>
      <div style={{ fontWeight: 700, letterSpacing: '.04em' }}>SMCOAA Alumni Election Portal</div>
      <div style={{ fontSize: 13, marginTop: 6, color: '#6d5b87' }}>Preparing your secure election experience…</div>
    </div>
  );
}

function NotFound() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#341D61',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      fontFamily: 'Arial, sans-serif'
    }}>
      <h1 style={{fontSize: '4rem',color: '#e6def2',margin: '0'}}>⚠️</h1>
      <h1 style={{color: '#e6def2'}}>ERROR 404</h1>
      <p>Page not found</p>
      <Link to="/" style={{color: '#e6def2',marginTop: '16px'}}>Go Home</Link>
    </div>
  );
}

// Dashboard routes retain their skeleton; lighter routes use the branded Angel loader.
const SKELETON_ROUTES = ['/student', '/admin-dashboard', '/staff-dashboard', '/super-admin-dashboard', '/audit-verification'];
function RouteFallback() {
  const location = useLocation();
  return SKELETON_ROUTES.includes(location.pathname) ? <PageSkeleton /> : <LoadingScreen />;
}

function App() {
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 800);
    return () => clearTimeout(timer);
  }, []);

  if (loading) return <LoadingScreen />;

  return (
    <>
      {/* Renders the install popup on every page */}
      <InstallPrompt />

      {/* Super Admin live monitoring — heartbeat for every page. Renders nothing. */}
      <PresenceProvider />

      {/*
        ===== FIX: Wrap Routes in ErrorBoundary =====
        Without this, ANY runtime error in any lazy-loaded page
        silently kills the entire React tree → blank white page.
      */}
      <ErrorBoundary>
        {/* 📦 Suspense intercepts the loading gap when a user switches between pages */}
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/student-login" element={<StudentLogin />} />
            <Route path="/student" element={<StudentDashboard />} />
            <Route path="/admin-login" element={<AdminLogin />} />
            <Route path="/admin-dashboard" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
            <Route path="/support" element={<Support />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/rules" element={<Rules />} />
            <Route path="/staff-login" element={<StaffLogin />} />
            {/* Secret staff shortcut → always resolves to Staff Login (works despite service-worker caching) */}
            <Route path="/staff-monitor" element={<Navigate to="/staff-login" replace />} />
            <Route path="/staff-dashboard" element={<StaffDashboard />} />
            {/* Super Admin control room — only reachable via the Admin Dashboard link */}
            <Route path="/super-admin-login" element={<SuperAdminLogin />} />
            <Route path="/super-admin-dashboard" element={<SuperAdminRoute><SuperAdminDashboard /></SuperAdminRoute>} />
            <Route path="/audit-verification" element={<SuperAdminRoute><AuditVerificationDashboard /></SuperAdminRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </>
  );
}

export default App