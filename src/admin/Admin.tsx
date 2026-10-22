import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Globe2,
  LayoutDashboard,
  LogOut,
  Shield,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";
import { authClient, API_ORIGIN } from "../lib/auth-client";
import { APP_URL } from "../lib/app-url";
import logoMark from "../../images/png-to-webp/logo-removebg-preview.webp";
import "./admin.css";

/**
 * Super admin panel (/dashboard).
 *
 * The panel is for the person who runs the deployment: every account, every
 * site and the global numbers. It is protected on the server as well - the
 * API refuses everything that does not come from a session with the admin
 * role, so hiding the UI is not the security boundary.
 */

type Overview = {
  totals: { users: number; admins: number; sites: number; events: number; sessions: number };
  recentUsers: AdminUser[];
  recentSites: AdminSite[];
};

type AdminUser = {
  id: string;
  name: string | null;
  email: string;
  emailVerified: boolean | number;
  role: string;
  createdAt: number;
  projects?: number;
};

type AdminSite = {
  id?: number;
  publicId: string;
  name: string;
  origin: string;
  owner?: string | null;
  createdAt: number;
  eventsToday?: number;
  dailyEventLimit?: number;
  retentionDays?: number;
};

function fmtDate(value: number): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function fmtInt(value: number | undefined | null): string {
  return new Intl.NumberFormat("tr-TR").format(Number(value ?? 0));
}

/* ------------------------------------------------------------------- gate */

/**
 * The console lives on its own origin, but the session cookie is shared
 * (AUTH_COOKIE_DOMAIN), so a sign in there covers this panel as well. These
 * links are the fallback for a visitor who is not signed in yet.
 */
const CONSOLE_LOGIN = `${APP_URL}/login`;
const CONSOLE_FORGOT = `${APP_URL}/forgot-password`;

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await authClient.signIn.email({ email, password });
    setBusy(false);
    if (signInError) {
      setError("Giriş başarısız. E-posta ve şifreyi kontrol edin.");
      return;
    }
    onSignedIn();
  };

  return (
    <div className="super__gate">
      <form className="super__card" onSubmit={submit}>
        <img src={logoMark} alt="" width={40} height={40} />
        <h1>Super admin</h1>
        <p>Panele erişmek için yönetici hesabıyla giriş yapın.</p>
        {error ? <p className="super__error">{error}</p> : null}
        <label className="super__field">
          <span>E-posta</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="admin@alanadi.com"
          />
        </label>
        <label className="super__field">
          <span>Şifre</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••••"
          />
        </label>
        <button className="super__btn" type="submit" disabled={busy}>
          {busy ? "Giriş yapılıyor…" : "Giriş yap"}
        </button>
        <p className="super__hint">
          Aynı hesap Console&apos;da da kullanılıyor:{" "}
          <a href={CONSOLE_LOGIN}>Console giriş ekranı</a> ·{" "}
          <a href={CONSOLE_FORGOT}>Şifremi unuttum</a>
        </p>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ panel */

export default function Admin() {
  const session = authClient.useSession();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [sites, setSites] = useState<AdminSite[]>([]);
  const [tab, setTab] = useState<"overview" | "users" | "sites">("overview");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const role = (session.data?.user as { role?: string } | undefined)?.role;
  const isAdmin = role === "admin";

  const load = useCallback(async () => {
    setError(null);
    try {
      const [summary, userList, siteList] = await Promise.all([
        fetch(`${API_ORIGIN}/api/super/overview`, { credentials: "include" }),
        fetch(`${API_ORIGIN}/api/super/users?limit=100`, { credentials: "include" }),
        fetch(`${API_ORIGIN}/api/super/sites?limit=100`, { credentials: "include" }),
      ]);
      if (summary.status === 403) {
        setError("Bu hesap super admin değil.");
        return;
      }
      if (summary.status === 401) {
        setError("Oturum bulunamadı.");
        return;
      }
      if (!summary.ok) {
        setError("Panele erişilemedi.");
        return;
      }
      setOverview((await summary.json()) as Overview);
      setUsers(((await userList.json()) as { users: AdminUser[] }).users ?? []);
      setSites(((await siteList.json()) as { sites: AdminSite[] }).sites ?? []);
    } catch {
      setError("Panel verisi alınamadı.");
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const setRole = async (id: string, next: string) => {
    setBusy(true);
    setError(null);
    const response = await fetch(`${API_ORIGIN}/api/super/users/${id}/role`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role: next }),
    });
    setBusy(false);
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(
        payload.error === "last_admin"
          ? "Son adminin rolü düşürülemez."
          : "Rol değiştirilemedi.",
      );
      return;
    }
    void load();
  };

  const removeSite = async (publicId: string) => {
    if (!window.confirm(`${publicId} sitesi ve tüm verisi silinsin mi?`)) return;
    setBusy(true);
    setError(null);
    const response = await fetch(`${API_ORIGIN}/api/super/sites/${publicId}`, {
      method: "DELETE",
      credentials: "include",
    });
    setBusy(false);
    if (!response.ok) {
      setError("Site silinemedi.");
      return;
    }
    void load();
  };

  /* ------------------------------------------------------------- render */

  if (session.isPending) {
    return (
      <div className="super__gate">
        <p className="super__muted">Oturum kontrol ediliyor…</p>
      </div>
    );
  }

  if (!session.data?.user) {
    return <SignIn onSignedIn={() => void load()} />;
  }

  if (!isAdmin) {
    return (
      <div className="super__gate">
        <div className="super__card">
          <Shield size={30} aria-hidden />
          <h1>Erişim yok</h1>
          <p>
            Bu panel yalnızca super admin hesaplarına açıktır. Panelden bir
            yöneticiye yetki verilebilir.
          </p>
          <button
            className="super__btn"
            type="button"
            onClick={async () => {
              await authClient.signOut();
              window.location.reload();
            }}
          >
            <LogOut size={15} aria-hidden /> Oturumu kapat
          </button>
        </div>
      </div>
    );
  }

  const totals = overview?.totals;

  return (
    <div className="super">
      <header className="super__bar">
        <div className="super__brand">
          <img src={logoMark} alt="" width={26} height={26} />
          <span>
            <b>DYNAMIC</b> Super admin
          </span>
        </div>
        <nav className="super__tabs" aria-label="Panel bölümleri">
          <button
            type="button"
            className={tab === "overview" ? "is-active" : ""}
            onClick={() => setTab("overview")}
          >
            <LayoutDashboard size={15} aria-hidden /> Genel bakış
          </button>
          <button
            type="button"
            className={tab === "users" ? "is-active" : ""}
            onClick={() => setTab("users")}
          >
            <Users size={15} aria-hidden /> Hesaplar
          </button>
          <button
            type="button"
            className={tab === "sites" ? "is-active" : ""}
            onClick={() => setTab("sites")}
          >
            <Globe2 size={15} aria-hidden /> Siteler
          </button>
        </nav>
        <div className="super__account">
          <span>{session.data.user.email}</span>
          <button
            type="button"
            onClick={async () => {
              await authClient.signOut();
              window.location.reload();
            }}
          >
            <LogOut size={14} aria-hidden /> Çıkış
          </button>
        </div>
      </header>

      {error ? (
        <p className="super__error super__error--bar">
          <AlertTriangle size={15} aria-hidden /> {error}
        </p>
      ) : null}

      <main className="super__main">
        {tab === "overview" ? (
          <>
            <section className="super__cards">
              <article className="super__card super__card--stat">
                <span>Hesap</span>
                <strong>{fmtInt(totals?.users)}</strong>
              </article>
              <article className="super__card super__card--stat">
                <span>Super admin</span>
                <strong>{fmtInt(totals?.admins)}</strong>
              </article>
              <article className="super__card super__card--stat">
                <span>Site</span>
                <strong>{fmtInt(totals?.sites)}</strong>
              </article>
              <article className="super__card super__card--stat">
                <span>Event</span>
                <strong>{fmtInt(totals?.events)}</strong>
              </article>
              <article className="super__card super__card--stat">
                <span>Oturum</span>
                <strong>{fmtInt(totals?.sessions)}</strong>
              </article>
            </section>

            <section className="super__panel">
              <h2>Son kayıtlar</h2>
              <table className="super__table">
                <thead>
                  <tr>
                    <th>E-posta</th>
                    <th>Rol</th>
                    <th>Doğrulama</th>
                    <th>Kayıt</th>
                  </tr>
                </thead>
                <tbody>
                  {(overview?.recentUsers ?? []).map((user) => (
                    <tr key={user.id}>
                      <td>{user.email}</td>
                      <td>
                        <span className={user.role === "admin" ? "super__tag super__tag--admin" : "super__tag"}>
                          {user.role === "admin" ? "admin" : "user"}
                        </span>
                      </td>
                      <td>{user.emailVerified ? "Doğrulandı" : "Bekliyor"}</td>
                      <td>{fmtDate(user.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        ) : null}

        {tab === "users" ? (
          <section className="super__panel">
            <h2>Hesaplar ({users.length})</h2>
            <table className="super__table">
              <thead>
                <tr>
                  <th>E-posta</th>
                  <th>Proje</th>
                  <th>Doğrulama</th>
                  <th>Kayıt</th>
                  <th>Rol</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.email}</td>
                    <td>{fmtInt(user.projects)}</td>
                    <td>{user.emailVerified ? "Doğrulandı" : "Bekliyor"}</td>
                    <td>{fmtDate(user.createdAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="super__action"
                        disabled={busy}
                        onClick={() =>
                          void setRole(user.id, user.role === "admin" ? "user" : "admin")
                        }
                      >
                        <UserCheck size={14} aria-hidden />
                        {user.role === "admin" ? "Admin'i kaldır" : "Admin yap"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {tab === "sites" ? (
          <section className="super__panel">
            <h2>Siteler ({sites.length})</h2>
            <table className="super__table">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Origin</th>
                  <th>Sahip</th>
                  <th>Bugün</th>
                  <th>Kayıt</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sites.map((site) => (
                  <tr key={site.publicId}>
                    <td>{site.name}</td>
                    <td className="super__mono">{site.origin}</td>
                    <td>{site.owner ?? "-"}</td>
                    <td>{fmtInt(site.eventsToday)}</td>
                    <td>{fmtDate(site.createdAt)}</td>
                    <td>
                      <button
                        type="button"
                        className="super__action super__action--danger"
                        disabled={busy}
                        onClick={() => void removeSite(site.publicId)}
                      >
                        <Trash2 size={14} aria-hidden /> Sil
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </main>
    </div>
  );
}
