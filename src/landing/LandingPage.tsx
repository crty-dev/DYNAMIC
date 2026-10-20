import { useRef, useState, type CSSProperties } from "react";
import {
  Atom,
  Braces,
  Check,
  Cloud,
  Database,
  Flame,
  Gauge,
  Mail,
  Scale,
  Zap,
} from "lucide-react";
import logoDark from "../../assets/brand/svg/dynamic-logo-horizontal-on-dark.svg";
import analyticsIcon from "../../assets/brand/svg/products/analytics-icon.svg";
import rumIcon from "../../assets/brand/svg/products/rum-icon.svg";
import sdkIcon from "../../assets/brand/svg/products/sdk-icon.svg";
import consoleIcon from "../../assets/brand/svg/products/console-icon.svg";
import GithubMark from "./GithubMark";
import DashMock from "./DashMock";
import TypewriterCode from "./TypewriterCode";
import { useHeroParallax, useReveal } from "./hooks";
import "./landing.css";

const REPO = "https://github.com/crty-dev/DYNAMIC";

const STACK = [
  { icon: Cloud, label: "Cloudflare Workers" },
  { icon: Atom, label: "React" },
  { icon: Braces, label: "TypeScript" },
  { icon: Flame, label: "Hono" },
  { icon: Database, label: "Cloudflare D1" },
  { icon: Gauge, label: "web-vitals" },
  { icon: Zap, label: "Vite" },
  { icon: Scale, label: "MIT License" },
];

function StackList({ hidden = false }: { hidden?: boolean }) {
  return (
    <div className="stack__list" aria-hidden={hidden || undefined}>
      {STACK.map(({ icon: Icon, label }) => (
        <span className="stack__item" key={label}>
          <Icon size={17} strokeWidth={2.1} aria-hidden />
          {label}
        </span>
      ))}
    </div>
  );
}

const delay = (ms: number) => ({ "--reveal-delay": `${ms}ms` }) as CSSProperties;

export default function LandingPage() {
  const [open, setOpen] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  useReveal();
  useHeroParallax(heroRef);
  const close = () => setOpen(false);

  return (
    <div className="landing">
      <a className="skip" href="#main">
        Skip to content
      </a>

      <header className="nav">
        <div className="nav__inner container">
          <a className="nav__brand" href="/" aria-label="DYNAMIC — home">
            <img src={logoDark} alt="DYNAMIC" />
          </a>
          <nav className="nav__links" aria-label="Primary">
            <a href="#features">Features</a>
            <a href="#rum">RUM</a>
            <a href="#sdk">SDK</a>
            <a href="#console">Console</a>
          </nav>
          <div className="nav__actions">
            <a className="button button--ghost button--sm" href={REPO} target="_blank" rel="noreferrer">
              <GithubMark size={15} /> GitHub
            </a>
            <a className="button button--solid button--sm" href="/dashboard">
              Get started
            </a>
          </div>
          <button
            type="button"
            className="nav__toggle"
            aria-expanded={open}
            aria-controls="nav-menu"
            aria-label="Toggle navigation"
            onClick={() => setOpen((v) => !v)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
        <div id="nav-menu" className={open ? "nav__menu is-open" : "nav__menu"}>
          <nav className="nav__menu-inner" aria-label="Primary, mobile">
            <a href="#features" onClick={close}>Features</a>
            <a href="#rum" onClick={close}>RUM</a>
            <a href="#sdk" onClick={close}>SDK</a>
            <a href="#console" onClick={close}>Console</a>
            <div className="nav__menu-cta">
              <a className="button button--ghost button--sm" href={REPO} target="_blank" rel="noreferrer" onClick={close}>
                <GithubMark size={15} /> GitHub
              </a>
              <a className="button button--solid button--sm" href="/dashboard" onClick={close}>
                Get started
              </a>
            </div>
          </nav>
        </div>
      </header>

      <main id="main">
        {/* ------------------------------- hero ------------------------------- */}
        <div className="hero" ref={heroRef}>
          <p className="hero__banner" data-reveal>
            100% open source under MIT&nbsp;—&nbsp;
            <a href={REPO} target="_blank" rel="noreferrer">
              star us on GitHub
            </a>
          </p>
          <h1 className="hero__title" data-reveal style={delay(60)}>
            Modern analytics
            <br />
            <span className="hero__accent">for the open web.</span>
          </h1>
          <p className="hero__sub" data-reveal style={delay(140)}>
            DYNAMIC is an open-source, privacy-first analytics &amp; RUM platform that runs entirely on
            Cloudflare's free tier. No cookies. No personal data. No surprise invoices — ever.
          </p>
          <div className="hero__actions" data-reveal style={delay(220)}>
            <a className="button button--solid" href="/dashboard">
              Get started
            </a>
            <a className="button button--ghost" href={REPO} target="_blank" rel="noreferrer">
              <GithubMark size={16} /> View on GitHub
            </a>
          </div>

          <div className="showcase">
            <div className="showcase__glow showcase__glow--a" aria-hidden />
            <div className="showcase__glow showcase__glow--b" aria-hidden />
            <div className="container showcase__stage" data-reveal style={delay(240)}>
              <DashMock />
            </div>
          </div>
        </div>

        {/* ----------------------------- tech strip --------------------------- */}
        <section className="stack" aria-label="Built on open technology">
          <p className="stack__head" data-reveal>
            Built on proven open technology — nothing proprietary in the stack
          </p>
          <div className="stack__row" data-reveal style={delay(80)}>
            <div className="stack__track">
              <StackList />
              <StackList hidden />
            </div>
          </div>
        </section>

        {/* ------------------------------ features ---------------------------- */}
        <section className="features" id="features">
          <div className="section-head container" data-reveal>
            <span className="section-head__tag">The platform</span>
            <h2 className="section-head__title">One stack. Every signal.</h2>
            <p className="section-head__sub">
              Four products that share one privacy-first data model, deployed together on Cloudflare's
              global edge.
            </p>
          </div>
          <div className="features__grid container">
            <article className="card" data-reveal>
              <img className="card__icon" src={analyticsIcon} alt="" aria-hidden />
              <p className="card__name">DYNAMIC Analytics</p>
              <h3 className="card__title">Cookieless, real-time analytics</h3>
              <p className="card__text">
                Pageviews, referrers, devices and goals in real time — collected without cookies or
                personal data, so you never need a consent banner.
              </p>
            </article>
            <article className="card" id="rum" data-reveal style={delay(90)}>
              <img className="card__icon" src={rumIcon} alt="" aria-hidden />
              <p className="card__name">DYNAMIC RUM</p>
              <h3 className="card__title">Performance from real users</h3>
              <p className="card__text">
                Core Web Vitals — LCP, INP and CLS — collected from your actual visitors with Google's
                web-vitals and aggregated in D1 at the edge.
              </p>
            </article>
            <article className="card" id="console" data-reveal style={delay(180)}>
              <img className="card__icon" src={consoleIcon} alt="" aria-hidden />
              <p className="card__name">DYNAMIC Console</p>
              <h3 className="card__title">One console for everything</h3>
              <p className="card__text">
                Live event streams, site settings and API keys for every DYNAMIC product in one place —
                your dashboard is a Worker, not a bill.
              </p>
            </article>
          </div>
        </section>

        {/* --------------------------------- SDK ------------------------------ */}
        <section className="sdk-wrap" id="sdk">
          <div className="container">
            <div className="sdk" data-reveal>
              <div className="sdk__info">
                <div className="sdk__eyebrow">
                  <img className="sdk__icon" src={sdkIcon} alt="" aria-hidden />
                  <p className="card__name">DYNAMIC SDK</p>
                </div>
                <h2 className="sdk__title">A tiny SDK, wired in minutes</h2>
                <p className="sdk__text">
                  One <code>&lt;script&gt;</code> tag — or one npm install — and every page, route change
                  and Web Vital starts flowing into your own Worker.
                </p>
                <ul className="sdk__list">
                  <li>
                    <Check size={18} strokeWidth={2.4} aria-hidden />
                    <span>
                      Zero-config: embed a tag or run <code>npm i @dynamic/sdk</code>
                    </span>
                  </li>
                  <li>
                    <Check size={18} strokeWidth={2.4} aria-hidden />
                    <span>Cookieless by design — no consent banner required</span>
                  </li>
                  <li>
                    <Check size={18} strokeWidth={2.4} aria-hidden />
                    <span>SPA-aware: virtual pageviews and section tracking</span>
                  </li>
                  <li>
                    <Check size={18} strokeWidth={2.4} aria-hidden />
                    <span>Batched with sendBeacon; dropped payloads are retried</span>
                  </li>
                </ul>
              </div>
              <TypewriterCode />
            </div>
          </div>
        </section>

        {/* --------------------------------- CTA ------------------------------ */}
        <section className="cta" id="cta">
          <div className="container">
            <div className="cta__box" data-reveal>
              <h2 className="cta__title">
                Start free. <span className="cta__accent">Stay free.</span>
              </h2>
              <p className="cta__sub">
                DYNAMIC ships entirely on the Cloudflare free tier: 100k requests a day, 5 GB of D1
                storage and unlimited static asset requests. Deploy your own in minutes — and keep your
                data yours.
              </p>
              <div className="cta__actions">
                <a className="button button--solid" href={REPO} target="_blank" rel="noreferrer">
                  Deploy your own
                </a>
                <a className="button button--ghost" href="/dashboard">
                  Explore the console
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* -------------------------------- footer ---------------------------- */}
      <footer className="footer">
        <div className="container">
          <div className="footer__grid">
            <div>
              <img className="footer__logoimg" src={logoDark} alt="DYNAMIC" />
              <p className="footer__desc">
                Privacy-first web analytics and RUM for the open web — open source under the MIT
                license, running entirely on the Cloudflare free tier.
              </p>
              <div className="footer__social">
                <a href={REPO} target="_blank" rel="noreferrer" aria-label="DYNAMIC on GitHub">
                  <GithubMark size={17} />
                </a>
                <a href="mailto:info@crty-dev.com" aria-label="Email DYNAMIC">
                  <Mail size={17} aria-hidden />
                </a>
              </div>
            </div>
            <nav aria-label="Products">
              <h3 className="footer__h">Products</h3>
              <ul className="footer__list">
                <li><a href="#features">DYNAMIC Analytics</a></li>
                <li><a href="#rum">DYNAMIC RUM</a></li>
                <li><a href="#sdk">DYNAMIC SDK</a></li>
                <li><a href="#console">DYNAMIC Console</a></li>
              </ul>
            </nav>
            <nav aria-label="Project">
              <h3 className="footer__h">Project</h3>
              <ul className="footer__list">
                <li><a href={REPO} target="_blank" rel="noreferrer">GitHub</a></li>
                <li><a href={`${REPO}/releases`} target="_blank" rel="noreferrer">Releases</a></li>
                <li><a href={`${REPO}/blob/main/docs/ROADMAP.md`} target="_blank" rel="noreferrer">Roadmap</a></li>
                <li><a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">License (MIT)</a></li>
              </ul>
            </nav>
            <div>
              <h3 className="footer__h">Contact</h3>
              <div className="footer__contact">
                <span className="footer__contact-label">Email</span>
                <a className="footer__contact-value" href="mailto:info@crty-dev.com">info@crty-dev.com</a>
                <span className="footer__contact-label">Web</span>
                <a className="footer__contact-value" href="https://dynamic.crty-dev.com/">dynamic.crty-dev.com</a>
              </div>
            </div>
          </div>
          <div className="footer__bottom">
            <span>© 2026 DYNAMIC. All rights reserved.</span>
            <span className="footer__badge">
              <Cloud size={14} aria-hidden /> Built on Cloudflare Workers · MIT
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
