import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { ArrowRight, Check, LogOut, Mail, RefreshCw, Trash2, User } from "lucide-react";
import {
  ApiError,
  APP_BASE_PATH,
  authClient,
  fetchMailStatus,
  fmtInt,
  fmtMetric,
  projectsApi,
  type Project,
  type ProjectStats,
} from "./api";
import {
  AuthShell,
  PasswordField,
  SocialButtons,
  StrengthMeter,
  TextField,
  useSocialProviders,
} from "./auth-shell";
import { PRIVACY_URL } from "../lib/app-url";

/* ------------------------------------------------------------------ shared */

function CopyButton({ value, label = "Kopyala" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {copied ? "Kopyalandı" : label}
    </button>
  );
}

function StatusPill({ status }: { status: Project["status"] }) {
  if (status === "verified") return <span className="pill pill--ok">Doğrulandı</span>;
  if (status === "verifying") return <span className="pill pill--wait">Kontrol ediliyor</span>;
  return <span className="pill">Bekliyor</span>;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "Beklenmeyen bir hata oluştu.");
  }
  return "Beklenmeyen bir hata oluştu.";
}

/* ------------------------------------------------------------------- login */

export function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const providers = useSocialProviders();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await authClient.signIn.email({
      email,
      password,
      rememberMe: remember,
    });
    setBusy(false);
    if (signInError) {
      setError(
        signInError.status === 403
          ? "E-posta adresiniz doğrulanmamış. Lütfen doğrulama e-postasındaki bağlantıyı kullanın."
          : "Giriş başarısız. E-posta ve şifreyi kontrol edin.",
      );
      return;
    }
    const from = (location.state as { from?: string } | null)?.from;
    navigate(from ?? "/", { replace: true });
  };

  return (
    <AuthShell>
      <div className="auth">
        <div className="auth__head">
          <h1>Tekrar hoş geldiniz</h1>
          <p>Console&apos;a giriş yaparak devam edin.</p>
        </div>
        <SocialButtons providers={providers} onError={setError} />
        <form className="card" onSubmit={submit}>
          {error ? <p className="alert alert--error">{error}</p> : null}
          <TextField
            label="E-posta"
            icon={<Mail size={16} aria-hidden />}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="siz@alanadi.com"
          />
          <PasswordField
            label="Şifre"
            autoComplete="current-password"
            required
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••••"
          />
          <label className="check">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
            />
            <span>Beni hatırla</span>
          </label>
          <button className="button button--block" type="submit" disabled={busy}>
            {busy ? "Giriş yapılıyor…" : "Giriş yap"}
          </button>
        </form>
        <p className="auth__foot">
          Şifrenizi mi unuttunuz? <Link to="/forgot-password">Sıfırla</Link>
        </p>
        <p className="auth__foot">
          Hesabınız yok mu? <Link to="/register">Kayıt olun</Link>
        </p>
      </div>
    </AuthShell>
  );
}

/* ---------------------------------------------------------------- register */

export function Register() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const providers = useSocialProviders();
  const [mailEnabled, setMailEnabled] = useState(true);

  useEffect(() => {
    let alive = true;
    void fetchMailStatus().then((status) => {
      if (alive) setMailEnabled(status.enabled);
    });
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signUpError } = await authClient.signUp.email({
      name,
      email,
      password,
      callbackURL: `${APP_BASE_PATH}/verify-email`,
    });
    setBusy(false);
    if (signUpError) {
      setError(
        signUpError.status === 422
          ? "Şifre en az 10 karakter olmalı ve alanlar doğru doldurulmalı."
          : "Kayıt başarısız. E-posta adresi zaten kayıtlı olabilir.",
      );
      return;
    }
    // The account is not verified yet, so there is no session: remember the
    // address so that the verification page can resend the mail.
    rememberPendingEmail(email);
    navigate("/verify-email", { replace: true });
  };

  return (
    <AuthShell>
      <div className="auth">
        <div className="auth__head">
          <h1>Hesap oluşturun</h1>
          <p>Ücretsiz, çerezsiz, kendi altyapınızda.</p>
        </div>
        {mailEnabled ? null : (
          <p className="alert alert--error">
            Bu dağıtımda e-posta gönderimi yapılandırılmamış. Hesabınız oluşturuldu
            ancak doğrulama e-postası gönderilemiyor.
          </p>
        )}
        <SocialButtons providers={providers} onError={setError} />
        <form className="card" onSubmit={submit}>
          {error ? <p className="alert alert--error">{error}</p> : null}
          <TextField
            label="Ad"
            icon={<User size={16} aria-hidden />}
            type="text"
            autoComplete="name"
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Adınız"
          />
          <TextField
            label="E-posta"
            icon={<Mail size={16} aria-hidden />}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="siz@alanadi.com"
          />
          <PasswordField
            label="Şifre"
            autoComplete="new-password"
            required
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="En az 10 karakter"
          />
          <StrengthMeter password={password} />
          <span className="field__hint">En az 10 karakter. Uzun bir cümle iyi bir şifredir.</span>
          <button className="button button--block" type="submit" disabled={busy}>
            {busy ? "Hesap oluşturuluyor…" : "Hesap oluştur"}
          </button>
        </form>
        <p className="auth__legal">
          Kayıt olarak <a href={PRIVACY_URL} target="_blank" rel="noreferrer">Gizlilik Politikası</a>
          &apos;nı kabul etmiş olursunuz. Hesabınızı istediğiniz zaman silebilirsiniz.
        </p>
        <p className="auth__foot">
          Zaten hesabınız var mı? <Link to="/login">Giriş yapın</Link>
        </p>
      </div>
    </AuthShell>
  );
}

/* ---------------------------------------------------------- verify e-mail */

/** The address of the account that was just created (no session yet). */
const PENDING_EMAIL_KEY = "dynamic:pending-verification";

function pendingEmail(): string {
  try {
    return window.sessionStorage.getItem(PENDING_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberPendingEmail(email: string): void {
  try {
    window.sessionStorage.setItem(PENDING_EMAIL_KEY, email);
  } catch {
    /* private mode */
  }
}

export function VerifyEmail() {
  const navigate = useNavigate();
  const session = authClient.useSession();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualEmail, setManualEmail] = useState("");
  const [mailEnabled, setMailEnabled] = useState(true);

  // The account was created without a session (the address is not proven yet),
  // so the address is remembered from the sign up form.
  const known = session.data?.user?.email ?? pendingEmail();
  const [email, setEmail] = useState(known);

  useEffect(() => {
    if (known) setEmail(known);
  }, [known]);

  useEffect(() => {
    let alive = true;
    void fetchMailStatus().then((status) => {
      if (alive) setMailEnabled(status.enabled);
    });
    return () => {
      alive = false;
    };
  }, []);

  const resend = async () => {
    const target = (email || manualEmail).trim();
    if (!target) {
      setError("E-posta adresinizi yazın.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: resendError } = await authClient.sendVerificationEmail({
      email: target,
    });
    setBusy(false);
    if (resendError) {
      setError(
        resendError.status === 400
          ? "Doğrulama e-postası gönderilemedi. Adresi kontrol edin ya da biraz sonra tekrar deneyin."
          : "Doğrulama e-postası gönderilemedi. Biraz sonra tekrar deneyin.",
      );
      return;
    }
    rememberPendingEmail(target);
    setSent(true);
  };

  const signOut = async () => {
    await authClient.signOut();
    navigate("/login", { replace: true });
  };

  return (
    <AuthShell>
      <div className="auth">
        <div className="auth__head">
          <h1>E-postanızı doğrulayın</h1>
          <p>
            {email
              ? `${email} adresine bir doğrulama bağlantısı gönderdik.`
              : "Hesabınızı oluşturun, ardından doğrulama bağlantısını açın."}
          </p>
        </div>
        <div className="card stack">
          {mailEnabled ? null : (
            <p className="alert alert--error">
              Bu dağıtımda e-posta gönderimi yapılandırılmamış, doğrulama e-postası
              gönderilemiyor. Yöneticiyle iletişime geçin.
            </p>
          )}
          {sent ? <p className="alert alert--ok">Yeni doğrulama e-postası gönderildi.</p> : null}
          {error ? <p className="alert alert--error">{error}</p> : null}
          {email ? null : (
            <label className="field">
              <span className="field__label">E-posta</span>
              <input
                className="field__input"
                type="email"
                autoComplete="email"
                required
                value={manualEmail}
                onChange={(event) => setManualEmail(event.target.value)}
                placeholder="siz@alanadi.com"
              />
            </label>
          )}
          <p className="card__text">
            Doğrulama bağlantısı 1 saat geçerlidir. E-postayı bulamazsanız spam klasörünü kontrol edin
            ya da yeni bir bağlantı isteyin.
          </p>
          <button className="button" type="button" onClick={resend} disabled={busy}>
            <RefreshCw size={15} aria-hidden />
            {busy ? "Gönderiliyor…" : "Tekrar gönder"}
          </button>
          <button className="button button--ghost" type="button" onClick={signOut}>
            <LogOut size={15} aria-hidden />
            Oturumu kapat
          </button>
        </div>
      </div>
    </AuthShell>
  );
}

/* --------------------------------------------------------- forgot password */

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: resetError } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${APP_BASE_PATH}/reset-password`,
    });
    setBusy(false);
    if (resetError) {
      setError("Sıfırlama isteği gönderilemedi. Biraz sonra tekrar deneyin.");
      return;
    }
    setSent(true);
  };

  return (
    <AuthShell>
      <div className="auth">
        <div className="auth__head">
          <h1>Şifrenizi sıfırlayın</h1>
          <p>Hesabınızın e-posta adresini girin, sıfırlama bağlantısı gönderelim.</p>
        </div>
        <form className="card" onSubmit={submit}>
          {sent ? (
            <p className="alert alert--ok">
              E-posta adresiniz kayıtlıysa bir sıfırlama bağlantısı gönderdik. (Hesabın yoksa da
              aynı mesajı gösteriyoruz.)
            </p>
          ) : null}
          {error ? <p className="alert alert--error">{error}</p> : null}
          <TextField
            label="E-posta"
            icon={<Mail size={16} aria-hidden />}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="siz@alanadi.com"
          />
          <button className="button button--block" type="submit" disabled={busy}>
            {busy ? "Gönderiliyor…" : "Sıfırlama bağlantısı gönder"}
          </button>
        </form>
        <p className="auth__foot">
          <Link to="/login">Giriş ekranına dön</Link>
        </p>
      </div>
    </AuthShell>
  );
}

/* ------------------------------------------------------------ reset password */

export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: resetError } = await authClient.resetPassword({
      newPassword: password,
      token,
    });
    setBusy(false);
    if (resetError) {
      setError(
        resetError.status === 400
          ? "Bu bağlantı geçersiz ya da süresi dolmuş. Yeni bir sıfırlama isteği gönderin."
          : "Şifre sıfırlanamadı. Biraz sonra tekrar deneyin.",
      );
      return;
    }
    navigate("/login", { replace: true });
  };

  return (
    <AuthShell>
      <div className="auth">
        <div className="auth__head">
          <h1>Yeni şifre belirleyin</h1>
          <p>En az 10 karakterli, daha önce kullanmadığınız bir şifre seçin.</p>
        </div>
        <form className="card" onSubmit={submit}>
          {error ? <p className="alert alert--error">{error}</p> : null}
          {!token ? (
            <p className="alert alert--error">
              Sıfırlama bağlantısı eksik. Lütfen e-postadaki bağlantıyı kullanın.
            </p>
          ) : null}
          <PasswordField
            label="Yeni şifre"
            autoComplete="new-password"
            required
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="En az 10 karakter"
          />
          <button className="button button--block" type="submit" disabled={busy || !token}>
            {busy ? "Kaydediliyor…" : "Şifreyi kaydet"}
          </button>
        </form>
      </div>
    </AuthShell>
  );
}

/* ------------------------------------------------------------------- sites */

export function Sites() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await projectsApi.list();
      setProjects(result.projects);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="stack">
      <div className="row">
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>
          Web siteleri
        </h2>
        <Link className="button" to="/sites/new" style={{ marginLeft: "auto" }}>
          Yeni web sitesi
          <ArrowRight size={15} aria-hidden />
        </Link>
      </div>

      {error ? <p className="alert alert--error">{error}</p> : null}
      {!projects && !error ? <p className="muted">Yükleniyor…</p> : null}

      {projects && projects.length === 0 ? (
        <div className="card stack">
          <h3 className="card__title">Henüz web sitesi eklemediniz</h3>
          <p className="card__text">
            Bir web sitesi ekleyin, alan adınızın DNS kaydını doğrulayın ve tek satırlık SDK
            kodunu sitenize ekleyin. Kurulumun tamamı Cloudflare Free planında çalışır.
          </p>
          <div>
            <Link className="button" to="/sites/new">
              İlk web sitenizi ekleyin
            </Link>
          </div>
        </div>
      ) : null}

      {projects && projects.length > 0 ? (
        <div className="list">
          {projects.map((project) => (
            <div className="item" key={project.id}>
              <div className="item__body">
                <b>{project.name}</b>
                <span>{project.hostname}</span>
              </div>
              <StatusPill status={project.status} />
              <Link className="button button--ghost" to={`/sites/${project.id}`}>
                {project.status === "verified" ? "Özet" : "Doğrula"}
              </Link>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- add site */

export function AddSite() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [hostname, setHostname] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await projectsApi.create(name, hostname);
      navigate(`/sites/${result.project.id}`, { replace: true });
    } catch (createError) {
      setError(errorMessage(createError));
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ maxWidth: 560 }}>
      <div>
        <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700 }}>Yeni web sitesi</h2>
        <p className="muted" style={{ margin: 0 }}>
          Alan adını girin; doğrulama kaydını size verelim.
        </p>
      </div>
      <form className="card" onSubmit={submit}>
        {error ? <p className="alert alert--error">{error}</p> : null}
        <label className="field">
          <span className="field__label">Görünen ad</span>
          <input
            className="field__input"
            type="text"
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Marketing sitesi"
          />
        </label>
        <label className="field">
          <span className="field__label">Alan adı</span>
          <input
            className="field__input"
            type="text"
            required
            value={hostname}
            onChange={(event) => setHostname(event.target.value)}
            placeholder="ornek.com"
          />
          <span className="field__hint">
            Yalnızca alan adı (https:// ve / yolu olmadan). Uluslararası alan adları
            (IDN) otomatik olarak punycode biçimine çevrilir.
          </span>
        </label>
        <button className="button" type="submit" disabled={busy}>
          {busy ? "Ekleniyor…" : "Web sitesi ekle"}
        </button>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------- verify site */

const VERIFY_TICK_MS = 5000;
const VERIFY_WINDOW_MS = 60_000;

export function VerifySite() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number>(Date.now());
  const timer = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await projectsApi.get(id);
      setProject(result.project);
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    timer.current = window.setInterval(() => {
      setElapsed(Date.now() - startedAt.current);
    }, 500);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, []);

  const check = useCallback(
    async () => {
      setChecking(true);
      setError(null);
      try {
        const result = await projectsApi.verify(id);
        setProject(result.project);
      } catch (verifyError) {
        if (verifyError instanceof ApiError && verifyError.status === 429) {
          setError(
            `Çok sık kontrol yapıldı. ${verifyError.payload.retryAfter ?? 10} saniye sonra tekrar deneyin.`,
          );
        } else {
          setError(errorMessage(verifyError));
        }
      } finally {
        setChecking(false);
      }
      void load();
    },
    [id, load],
  );

  // Bounded retry window: ~60 s, every 5 s, and only while the page is open.
  useEffect(() => {
    if (!project || project.status === "verified") return;
    if (elapsed > VERIFY_WINDOW_MS) return;
    const handle = window.setTimeout(() => {
      void check();
    }, VERIFY_TICK_MS);
    return () => window.clearTimeout(handle);
  }, [check, elapsed, project]);

  const progress = Math.min(100, Math.round((elapsed / VERIFY_WINDOW_MS) * 100));

  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <div className="row">
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>
          {project?.name ?? "Web sitesi"}
        </h2>
        {project ? <StatusPill status={project.status} /> : null}
      </div>

      {error ? <p className="alert alert--error">{error}</p> : null}

      {project ? (
        <>
          {project.status !== "verified" ? (
            <div className="card stack">
              <div>
                <h3 className="card__title">1. DNS kaydını ekleyin</h3>
                <p className="card__text">
                  Alan adınızın DNS sağlayıcısına aşağıdaki TXT kaydını ekleyin. DNS değişiklikleri
                  birkaç dakika ile 48 saat arasında yayılabilir; bu yüzden doğrulama hemen
                  tamamlanmayabilir.
                </p>
              </div>
              <div>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <span className="field__label" style={{ margin: 0 }}>
                    TXT kaydı
                  </span>
                  <CopyButton value={project.record.value} />
                </div>
                <pre className="code" style={{ marginTop: 8 }}>
                  {`Tür:   ${project.record.type}
Ad:    ${project.record.name}
Değer: ${project.record.value}`}
                </pre>
              </div>
              <div>
                <h3 className="card__title">2. Doğrulamayı tetikleyin</h3>
                <p className="card__text">
                  Kaydı ekledikten sonra doğrulamayı çalıştırın. Sunucu kaydı DNS üzerinden tek sefer
                  sorgular; istek başına 10 saniyelik bir sınır uygulanır.
                </p>
                <div className="progress" style={{ margin: "12px 0" }}>
                  <i style={{ width: `${progress}%` }} />
                </div>
                <div className="row">
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      startedAt.current = Date.now();
                      setElapsed(0);
                      void check();
                    }}
                    disabled={checking}
                  >
                    <RefreshCw size={15} aria-hidden />
                    {checking ? "Kontrol ediliyor…" : "Şimdi tekrar dene"}
                  </button>
                  <span className="faint mono">
                    {elapsed > VERIFY_WINDOW_MS
                      ? "Pencere doldu — elle tekrar deneyebilirsiniz."
                      : `${Math.max(0, Math.ceil((VERIFY_WINDOW_MS - elapsed) / 1000))} sn kaldı`}
                  </span>
                </div>
                {project.error ? (
                  <p className="alert" style={{ marginTop: 12 }}>
                    Son kontrol: <span className="mono">{project.error}</span> — kayıt henüz
                    görünmüyor. Değişikliğin yayılması biraz sürebilir.
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="card stack">
              <p className="alert alert--ok">
                <Check size={15} aria-hidden /> Alan adı doğrulandı. Şimdi SDK&apos;yı ekleyebilirsiniz.
              </p>
              <div>
                <h3 className="card__title">3. SDK&apos;yı ekleyin</h3>
                <p className="card__text">
                  Aşağıdaki satırı sitenizin &lt;head&gt; bölümüne ekleyin. Olaylar doğrudan sizin
                  Worker&apos;ınıza gider.
                </p>
                <pre className="code" style={{ marginTop: 10 }}>
                  {project.script}
                </pre>
              </div>
              <div>
                <Link className="button" to={`/sites/${project.id}/overview`}>
                  Siteye git
                  <ArrowRight size={15} aria-hidden />
                </Link>
              </div>
            </div>
          )}

          <div className="row row--end">
            <button
              className="button button--danger"
              type="button"
              onClick={async () => {
                if (!window.confirm("Bu web sitesi ve toplanan verileri silinsin mi?")) return;
                try {
                  await projectsApi.remove(project.id);
                  navigate("/", { replace: true });
                } catch (removeError) {
                  setError(errorMessage(removeError));
                }
              }}
            >
              <Trash2 size={15} aria-hidden />
              Web sitesini sil
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ site overview */

export function SiteOverview() {
  const { id = "" } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [stats, setStats] = useState<ProjectStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState("7d");

  useEffect(() => {
    projectsApi
      .get(id)
      .then((result) => setProject(result.project))
      .catch((loadError) => setError(errorMessage(loadError)));
  }, [id]);

  useEffect(() => {
    projectsApi
      .stats(id, range)
      .then(setStats)
      .catch((loadError) => setError(errorMessage(loadError)));
  }, [id, range]);

  const totals = stats?.summary?.totals;
  const metrics = stats?.rum?.metrics ?? [];

  return (
    <div className="stack">
      <div className="row">
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>
          {project?.name ?? "Web sitesi"}
        </h2>
        {project ? <StatusPill status={project.status} /> : null}
        <div className="console__range" style={{ marginLeft: "auto" }} role="group" aria-label="Aralık">
          {["24h", "7d", "30d"].map((key) => (
            <button
              key={key}
              type="button"
              className={range === key ? "is-active" : undefined}
              onClick={() => setRange(key)}
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="alert alert--error">{error}</p> : null}

      {project?.status !== "verified" && project ? (
        <p className="alert">
          Alan adı henüz doğrulanmadı. Veriler toplanmadan önce DNS kaydını ekleyip doğrulayın.
        </p>
      ) : null}

      <div className="grid-4">
        <div className="kpi">
          <span>Ziyaretçi</span>
          <b>{fmtInt(totals?.visitors ?? 0)}</b>
        </div>
        <div className="kpi">
          <span>Sayfa görüntüleme</span>
          <b>{fmtInt(totals?.pageviews ?? 0)}</b>
        </div>
        <div className="kpi">
          <span>Event</span>
          <b>{fmtInt(totals?.events ?? 0)}</b>
        </div>
        <div className="kpi">
          <span>Dönüşüm</span>
          <b>{fmtInt(totals?.conversions ?? 0)}</b>
        </div>
      </div>

      <div className="card stack">
        <h3 className="card__title">Kurulum</h3>
        <p className="card__text">
          Aşağıdaki satırı <span className="mono">&lt;head&gt;</span> bölümüne ekleyin. Kurulum
          tespit edilene kadar “analitik aktif” sayılmaz — veriler ancak ilk event
          geldiğinde görünür.
        </p>
        <pre className="code">{project?.script ?? "—"}</pre>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="card__title">En çok ziyaret edilen sayfalar</h3>
          {stats?.summary?.topPages?.length ? (
            <ul className="list" style={{ listStyle: "none" }}>
              {stats.summary.topPages.map((row) => (
                <li className="row" key={row.path} style={{ justifyContent: "space-between" }}>
                  <span className="mono">{row.path}</span>
                  <span className="faint mono">{fmtInt(row.n)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="card__text">Henüz veri yok.</p>
          )}
        </div>
        <div className="card">
          <h3 className="card__title">Web Vitals</h3>
          {metrics.length ? (
            <ul className="list" style={{ listStyle: "none" }}>
              {metrics.map((metric) => (
                <li className="row" key={metric.metric} style={{ justifyContent: "space-between" }}>
                  <span>
                    {metric.metric}
                    {metric.sufficient ? (
                      <span className="faint mono"> · {fmtInt(metric.samples)} örnek</span>
                    ) : null}
                  </span>
                  <span className="mono">
                    {metric.sufficient
                      ? `p75 ${fmtMetric(metric.metric, metric.p75)}`
                      : "yeterli veri yok"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="card__text">Henüz veri yok.</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- settings */

export function Settings() {
  const session = authClient.useSession();
  const [name, setName] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session.data?.user?.name) setName(session.data.user.name);
  }, [session.data?.user?.name]);

  const saveName = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const { error: updateError } = await authClient.updateUser({ name });
    setBusy(false);
    if (updateError) {
      setError("Profil güncellenemedi.");
      return;
    }
    setMessage("Profil güncellendi.");
  };

  const changePassword = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    const { error: passwordError } = await authClient.changePassword({
      currentPassword: current,
      newPassword: next,
      revokeOtherSessions: true,
    });
    setBusy(false);
    if (passwordError) {
      setError("Şifre değiştirilemedi. Mevcut şifreyi kontrol edin.");
      return;
    }
    setCurrent("");
    setNext("");
    setMessage("Şifreniz güncellendi, diğer oturumlar kapatıldı.");
  };

  const sessions = session.data?.session ? [session.data.session] : [];
  const expiresAt = useMemo(
    () => (session.data?.session?.expiresAt ? new Date(session.data.session.expiresAt) : null),
    [session.data?.session?.expiresAt],
  );

  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>Hesap ayarları</h2>

      {message ? <p className="alert alert--ok">{message}</p> : null}
      {error ? <p className="alert alert--error">{error}</p> : null}

      <form className="card" onSubmit={saveName}>
        <h3 className="card__title">Profil</h3>
        <label className="field">
          <span className="field__label">Ad</span>
          <input
            className="field__input"
            type="text"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">E-posta</span>
          <input className="field__input" type="email" value={session.data?.user?.email ?? ""} disabled />
          <span className="field__hint">E-posta adresi değiştirilemez.</span>
        </label>
        <button className="button" type="submit" disabled={busy}>
          {busy ? "Kaydediliyor…" : "Profili kaydet"}
        </button>
      </form>

      <form className="card" onSubmit={changePassword}>
        <h3 className="card__title">Şifre</h3>
        <label className="field">
          <span className="field__label">Mevcut şifre</span>
          <input
            className="field__input"
            type="password"
            autoComplete="current-password"
            required
            minLength={10}
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Yeni şifre</span>
          <input
            className="field__input"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            value={next}
            onChange={(event) => setNext(event.target.value)}
          />
        </label>
        <button className="button" type="submit" disabled={busy}>
          {busy ? "Kaydediliyor…" : "Şifreyi değiştir"}
        </button>
      </form>

      <div className="card stack">
        <h3 className="card__title">Oturumlar</h3>
        <p className="card__text">
          {sessions.length} aktif oturum. Oturumlar 7 gün sonunda otomatik olarak sona erer.
        </p>
        <p className="faint mono">
          Bu oturumun bitişi: {expiresAt ? expiresAt.toLocaleString("tr-TR") : "—"}
        </p>
        <div>
          <button
            className="button button--ghost"
            type="button"
            onClick={async () => {
              await authClient.signOut();
              window.location.assign("/login");
            }}
          >
            Tüm oturumlardan çıkış yap
          </button>
        </div>
      </div>
    </div>
  );
}
