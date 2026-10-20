import { useEffect, useState, type ReactNode } from "react";
import { Lock, Mail, ShieldCheck, Zap, Eye, EyeOff, Code2, User } from "lucide-react";
import { authClient, fetchSocialProviders, APP_BASE_PATH } from "./api";
import GithubMark from "../landing/GithubMark";
import logoMark from "../../images/png-to-webp/logo-removebg-preview.webp";

/**
 * The public console pages share one layout: the product story on the left,
 * the form on the right. On narrow screens the columns stack.
 */

/** The Google "G" - the official brand mark, coloured as in the guidelines. */
function GoogleMark({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.8z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.94-2.93l-3.88-3c-1.08.72-2.45 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.95H1.28v3.1A12 12 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27a7.2 7.2 0 0 1 0-4.54V6.63H1.28a12 12 0 0 0 0 10.74l4-3.1z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.76 0 3.34.61 4.59 1.8l3.43-3.43C17.95 1.19 15.24 0 12 0 7.7 0 3.99 2.47 1.28 6.63l4 3.1C6.23 6.86 8.88 4.75 12 4.75z"
      />
    </svg>
  );
}

const TRUST_POINTS = [
  { Icon: Code2, text: "%100 açık kaynak (MIT)" },
  { Icon: ShieldCheck, text: "Çerezsiz, gizlilik odaklı analitik" },
  { Icon: Zap, text: "Cloudflare Edge üzerinde, ücretsiz" },
];

const SAMPLE = `import { dynamic } from "@dynamic/sdk";

dynamic.init({ site: "yoursite.dev" });

// → 202 Accepted — cookieless, in D1`;

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-shell">
      <aside className="auth-shell__aside">
        <div className="auth-shell__brand">
          <img src={logoMark} alt="" width={34} height={34} />
          <span>
            <b>DYNAMIC</b> Console
          </span>
        </div>
        <h2 className="auth-shell__claim">
          Çerezsiz analitik,
          <br />
          kendi altyapınızda.
        </h2>
        <ul className="auth-shell__trust">
          {TRUST_POINTS.map(({ Icon, text }) => (
            <li key={text}>
              <Icon size={16} aria-hidden />
              {text}
            </li>
          ))}
        </ul>
        <pre className="auth-shell__code" aria-hidden>
          {SAMPLE}
        </pre>
      </aside>
      <div className="auth-shell__panel">{children}</div>
    </div>
  );
}

/* --------------------------------------------------------------- fields */

export function TextField({
  label,
  icon,
  ...input
}: { label: string; icon: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="field__control">
        <span className="field__icon">{icon}</span>
        <input className="field__input" {...input} />
      </span>
    </label>
  );
}

export function PasswordField({
  label,
  ...input
}: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <span className="field__control">
        <span className="field__icon">
          <Lock size={16} aria-hidden />
        </span>
        <input
          className="field__input"
          type={visible ? "text" : "password"}
          {...input}
        />
        <button
          type="button"
          className="field__toggle"
          onClick={() => setVisible((value) => !value)}
          aria-label={visible ? "Şifreyi gizle" : "Şifreyi göster"}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      </span>
    </label>
  );
}

/* ------------------------------------------------------------ strength */

const STRENGTH_LABELS = ["Çok zayıf", "Zayıf", "Orta", "İyi", "Çok iyi"];

/** A rough score (0-4). The server enforces the real rule: at least 10 chars. */
export function passwordStrength(password: string): { score: number; label: string } {
  if (!password) return { score: 0, label: "" };
  let score = 0;
  if (password.length >= 10) score += 1;
  if (password.length >= 14) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^\w\s]/.test(password)) score += 1;
  // The classics stay weak.
  if (/^(.)\1+$/.test(password) || /^(1234|qwer|password|abc123|letmein)/i.test(password)) {
    score = Math.min(score, 1);
  }
  score = Math.min(score, 4);
  return { score, label: STRENGTH_LABELS[score] };
}

export function StrengthMeter({ password }: { password: string }) {
  const { score, label } = passwordStrength(password);
  return (
    <div className="strength" aria-live="polite">
      <div className="strength__bars" data-score={score}>
        {[0, 1, 2, 3].map((index) => (
          <span key={index} className="strength__bar" data-on={index < score} />
        ))}
      </div>
      <span className="strength__label">{password ? label : ""}</span>
    </div>
  );
}

/* -------------------------------------------------------------- social */

/** The providers the server has credentials for. */
export function useSocialProviders(): string[] {
  const [providers, setProviders] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void fetchSocialProviders().then((list) => {
      if (alive) setProviders(list);
    });
    return () => {
      alive = false;
    };
  }, []);
  return providers;
}

export function SocialButtons({
  providers,
  onError,
}: {
  providers: string[];
  onError: (message: string) => void;
}) {
  if (providers.length === 0) return null;

  const start = async (provider: "github" | "google") => {
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: `${APP_BASE_PATH}/`,
    });
    if (error) onError("Sosyal giriş başlatılamadı. Lütfen tekrar deneyin.");
  };

  return (
    <>
      <div className="social">
        {providers.includes("github") ? (
          <button
            type="button"
            className="social__btn"
            onClick={() => void start("github")}
          >
            <GithubMark size={17} /> GitHub ile devam et
          </button>
        ) : null}
        {providers.includes("google") ? (
          <button
            type="button"
            className="social__btn"
            onClick={() => void start("google")}
          >
            <GoogleMark /> Google ile devam et
          </button>
        ) : null}
      </div>
      <p className="auth__or">
        <span>veya e-posta ile devam et</span>
      </p>
    </>
  );
}

export const FIELD_ICONS = { User, Mail };
