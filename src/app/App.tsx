import { useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router";
import {
  BarChart3,
  Globe2,
  LayoutDashboard,
  Menu,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import logoMark from "../../images/png-to-webp/logo-removebg-preview.webp";
import { authClient } from "./api";
import {
  AddSite,
  ForgotPassword,
  Login,
  Register,
  ResetPassword,
  Settings,
  SiteOverview,
  Sites,
  VerifyEmail,
  VerifySite,
} from "./pages";

/** Paths that never require a session. */
const PUBLIC_PATHS = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
];

function Brand() {
  return (
    <div className="app__brand">
      <img src={logoMark} alt="" width={30} height={30} />
      <span className="app__brand-text">
        <b>DYNAMIC</b>
        <span>Console</span>
      </span>
    </div>
  );
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const session = authClient.useSession();
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  const signOut = async () => {
    await authClient.signOut();
    window.location.assign("/login");
  };

  return (
    <div className="app">
      <aside className={navOpen ? "app__sidebar is-open" : "app__sidebar"}>
        <Brand />
        <nav className="app__nav" aria-label="Console">
          <NavLink
            to="/"
            end
            onClick={() => setNavOpen(false)}
            className={({ isActive }) => (isActive ? "is-active" : "")}
          >
            <LayoutDashboard size={16} strokeWidth={1.9} aria-hidden />
            Web siteleri
          </NavLink>
          <NavLink
            to="/settings"
            onClick={() => setNavOpen(false)}
            className={({ isActive }) => (isActive ? "is-active" : "")}
          >
            <SettingsIcon size={16} strokeWidth={1.9} aria-hidden />
            Hesap ayarları
          </NavLink>
          <a href="https://dynamic.crty-dev.com">
            <Globe2 size={16} strokeWidth={1.9} aria-hidden />
            Pazarlama sitesi
          </a>
        </nav>
        <div className="app__user">
          <b>{session.data?.user?.email ?? "—"}</b>
          {session.data?.user?.emailVerified ? "E-posta doğrulandı" : "E-posta bekliyor"}
          <button type="button" onClick={signOut}>
            Oturumu kapat
          </button>
        </div>
      </aside>

      <div className="app__main">
        <header className="app__topbar">
          <button
            type="button"
            className="app__toggle"
            aria-expanded={navOpen}
            aria-label="Menüyü aç/kapat"
            onClick={() => setNavOpen((open) => !open)}
          >
            {navOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          <h1>DYNAMIC Console</h1>
          <a href="/api/health" target="_blank" rel="noreferrer">
            API durumu
          </a>
        </header>
        <main className="app__content" key={location.pathname}>
          {children}
        </main>
      </div>
    </div>
  );
}

/** Requires a session; unverified accounts are pushed to the verification page. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const session = authClient.useSession();
  const location = useLocation();

  if (session.isPending) {
    return (
      <div className="center">
        <p className="muted">Oturum kontrol ediliyor…</p>
      </div>
    );
  }
  if (!session.data?.user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!session.data.user.emailVerified) {
    return <Navigate to="/verify-email" replace />;
  }
  return <AppLayout>{children}</AppLayout>;
}

export default function App() {
  const location = useLocation();
  const isPublic = PUBLIC_PATHS.some((path) => location.pathname.startsWith(path));

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <Sites />
          </RequireAuth>
        }
      />
      <Route
        path="/sites/new"
        element={
          <RequireAuth>
            <AddSite />
          </RequireAuth>
        }
      />
      <Route
        path="/sites/:id"
        element={
          <RequireAuth>
            <VerifySite />
          </RequireAuth>
        }
      />
      <Route
        path="/sites/:id/overview"
        element={
          <RequireAuth>
            <SiteOverview />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <Settings />
          </RequireAuth>
        }
      />
      <Route
        path="*"
        element={
          <Navigate to={isPublic ? "/login" : "/"} replace />
        }
      />
    </Routes>
  );
}

export { BarChart3 };
