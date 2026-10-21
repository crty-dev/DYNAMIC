import { lazy, Suspense, useRef, useState, type CSSProperties } from "react";
import { ArrowRight } from "lucide-react";
import logoMarkPng from "../../images/png-to-webp/logo-removebg-preview.webp";
import analyticsIconPng from "../../images/png-to-webp/DYNAMIC_Analytics-removebg-preview.webp";
import rumIconPng from "../../images/png-to-webp/DYNAMIC_RUM-removebg-preview.webp";
import sdkIconPng from "../../images/png-to-webp/DYNAMIC_SDK-removebg-preview.webp";
import consoleIconPng from "../../images/png-to-webp/DYNAMIC_Console-removebg-preview.webp";
import GithubMark from "./GithubMark";
import DashMock from "./DashMock";
import TypewriterCode from "./TypewriterCode";
import HalftoneWordmarkFooter from "../components/ui/halftone-wordmark-footer";
import DataRain from "../components/ui/data-rain";
import CloudinaryImage from "../components/ui/cloudinary-image";
import { SupportChat } from "../components/ui/support-chat";
import { Hero } from "../components/ui/tailwind-css-background-snippet";
import { CLOUDINARY_ASSETS, type CloudinaryAssetKey } from "../lib/cloudinary";
import { APP_URL } from "../lib/app-url";
import { openSupportChat } from "../lib/crisp";
import { STACK } from "./stack";
import { useHeroParallax, useMediaQuery, useReveal } from "./hooks";
import "./landing.css";

// framer-motion (and the beam diagram) load after the first paint, so the
// landing bundle stays small.
const TechStackBeam = lazy(() => import("./TechStackBeam"));

const REPO = "https://github.com/crty-dev/DYNAMIC";

const delay = (ms: number) => ({ "--reveal-delay": `${ms}ms` }) as CSSProperties;

const FOOTER_COLUMNS = [
  {
    title: "Contact",
    links: [
      { label: "Canlı destek", onClick: openSupportChat },
      { label: "info@crty-dev.com", href: "mailto:info@crty-dev.com" },
      { label: "Open an issue", href: "https://github.com/crty-dev/DYNAMIC/issues" },
    ],
  },
  {
    title: "Project",
    links: [
      { label: "GitHub", href: "https://github.com/crty-dev/DYNAMIC" },
      { label: "Releases", href: "https://github.com/crty-dev/DYNAMIC/releases" },
      { label: "Roadmap", href: "https://github.com/crty-dev/DYNAMIC/blob/main/docs/ROADMAP.md" },
      { label: "License (MIT)", href: "https://github.com/crty-dev/DYNAMIC/blob/main/LICENSE" },
    ],
  },
  {
    title: "Products",
    links: [
      { label: "Analytics", href: "#features" },
      { label: "RUM", href: "#rum" },
      { label: "SDK", href: "#sdk" },
      { label: "Console", href: APP_URL },
    ],
  },
];

function BrandMark({ className, eager = false }: { className: string; eager?: boolean }) {
  return (
    <CloudinaryImage
      className={className}
      publicId={CLOUDINARY_ASSETS.logo}
      fallbackSrc={logoMarkPng}
      width={42}
      height={42}
      sizes="(max-width: 640px) 36px, 42px"
      loading={eager ? "eager" : "lazy"}
    />
  );
}

function ProductIcon({
  asset,
  fallback,
  className,
  size,
  sizes,
}: {
  asset: CloudinaryAssetKey;
  fallback: string;
  className: string;
  size: number;
  sizes?: string;
}) {
  return (
    <CloudinaryImage
      className={className}
      publicId={CLOUDINARY_ASSETS[asset]}
      fallbackSrc={fallback}
      width={size}
      height={size}
      sizes={sizes}
    />
  );
}

export default function LandingPage() {
  const [open, setOpen] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const compact = useMediaQuery("(max-width: 768px)");
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
            <BrandMark className="nav__brand-mark" eager />
            <span className="nav__brand-word">DYNAMIC</span>
          </a>
          <nav className="nav__links" aria-label="Primary">
            <a href="#features">Features</a>
            <a href="#rum">RUM</a>
            <a href="#sdk">SDK</a>
            <a href={APP_URL}>Console</a>
          </nav>
          <div className="nav__actions">
            <a className="button button--ghost button--sm" href={REPO} target="_blank" rel="noreferrer">
              <GithubMark size={15} /> GitHub
            </a>
            <a className="button button--ghost button--sm" href={`${APP_URL}/login`}>
              Sign in
            </a>
            <a className="button button--solid button--sm" href={`${APP_URL}/register`}>
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
            <a href={APP_URL} onClick={close}>Console</a>
            <div className="nav__menu-cta">
              <a className="button button--ghost button--sm" href={REPO} target="_blank" rel="noreferrer" onClick={close}>
                <GithubMark size={15} /> GitHub
              </a>
              <a className="button button--solid button--sm" href={`${APP_URL}/register`} onClick={close}>
                Get started
              </a>
            </div>
          </nav>
        </div>
      </header>

      <main id="main">
        {/* ------------------------------- hero ------------------------------- */}
        <section className="hero" ref={heroRef}>
          <div className="container hero__inner">
            <p className="hero__banner" data-reveal>
              100% open source under MIT —{" "}
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
              DYNAMIC is an open-source, privacy-first analytics and RUM platform that runs entirely
              on Cloudflare&apos;s free tier. No cookies. No personal data. No surprise invoices.
            </p>
            <div className="hero__actions" data-reveal style={delay(220)}>
              <a className="button button--solid" href={`${APP_URL}/register`}>
                Get started
              </a>
              <a className="button button--ghost" href={REPO} target="_blank" rel="noreferrer">
                <GithubMark size={16} /> View on GitHub
              </a>
            </div>

            <div className="hero__showcase" data-reveal style={delay(240)}>
              <div className="hero__stage">
                <Hero wrapperClassName="hero__stage-bg" />
                <DashMock />
              </div>
            </div>
          </div>
        </section>

        {/* ----------------------------- tech stack ---------------------------- */}
        <section className="beam" aria-labelledby="beam-title">
          <div className="container">
            <div className="section-head" data-reveal>
              <span className="section-head__tag">The stack</span>
              <h2 className="section-head__title" id="beam-title">
                Built on proven open technology
              </h2>
              <p className="section-head__sub">Nothing proprietary in the stack.</p>
              <ul className="sr-only">
                {STACK.map((item) => (
                  <li key={item.key}>{item.label}</li>
                ))}
              </ul>
            </div>
            <div className="beam__canvas" data-reveal style={delay(80)}>
              <Suspense fallback={<div className="beam__fallback" aria-hidden />}>
                <TechStackBeam />
              </Suspense>
            </div>
          </div>
        </section>

        {/* ------------------------------ features ---------------------------- */}
        <section className="features" id="features">
          <div className="container">
            <div className="section-head" data-reveal>
              <span className="section-head__tag">The platform</span>
              <h2 className="section-head__title">Features that work for your future.</h2>
              <p className="section-head__sub">
                Analytics, RUM, SDK and Console share one privacy-first data model — deployed
                together on Cloudflare&apos;s global edge.
              </p>
            </div>

            <div className="features__grid">
              <article className="card card--half" data-reveal>
                <ProductIcon
                  className="card__icon"
                  asset="analytics"
                  fallback={analyticsIconPng}
                  size={76}
                  sizes="(max-width: 560px) 64px, 76px"
                />
                <p className="card__name">DYNAMIC Analytics</p>
                <h3 className="card__title">Analytics Dashboard</h3>
                <p className="card__text">
                  Pageviews, referrers, devices and goals in real time — collected without cookies
                  or personal data, so you never need a consent banner.
                </p>
                <div className="card__actions">
                  <a className="card__link" href="/demo">
                    View dashboard <ArrowRight size={15} strokeWidth={2.2} aria-hidden />
                  </a>
                </div>
              </article>

              <article className="card card--half" id="rum" data-reveal style={delay(90)}>
                <ProductIcon
                  className="card__icon"
                  asset="rum"
                  fallback={rumIconPng}
                  size={76}
                  sizes="(max-width: 560px) 64px, 76px"
                />
                <p className="card__name">DYNAMIC RUM</p>
                <h3 className="card__title">Real User Monitoring</h3>
                <p className="card__text">
                  Core Web Vitals from actual visitors — LCP, INP and CLS captured with
                  Google&apos;s web-vitals and aggregated in D1 at the edge.
                </p>
                <div className="card__actions">
                  <a className="card__link" href="/demo">
                    View RUM <ArrowRight size={15} strokeWidth={2.2} aria-hidden />
                  </a>
                </div>
              </article>
            </div>

            <article className="card card--wide" id="sdk" data-reveal>
              <div className="card__column">
                <div className="card__eyebrow">
                  <ProductIcon
                    className="card__icon card__icon--sm"
                    asset="sdk"
                    fallback={sdkIconPng}
                    size={58}
                    sizes="(max-width: 560px) 50px, 58px"
                  />
                  <p className="card__name">DYNAMIC SDK + Console</p>
                </div>
                <h3 className="card__title card__title--lg">A tiny SDK. One console.</h3>
                <p className="card__text">
                  Add one <code>&lt;script&gt;</code> tag — or one npm install — and every page,
                  route change and Web Vital starts flowing into your own Worker. Open the Console
                  to inspect live events, sites and keys in one place.
                </p>
                <div className="card__actions">
                  <a className="card__link" href={REPO} target="_blank" rel="noreferrer">
                    View the SDK <ArrowRight size={15} strokeWidth={2.2} aria-hidden />
                  </a>
                  <a className="card__link" href="/demo">
                    Explore Console <ArrowRight size={15} strokeWidth={2.2} aria-hidden />
                  </a>
                </div>
              </div>
              <div className="card__media">
                <TypewriterCode />
              </div>
            </article>

            <section className="card card--cta" id="cta" aria-labelledby="cta-title" data-reveal>
              <div className="cta__content">
                <span className="cta__badge" aria-hidden>
                  <ProductIcon
                    className="cta__icon"
                    asset="console"
                    fallback={consoleIconPng}
                    size={58}
                    sizes="(max-width: 560px) 48px, 58px"
                  />
                </span>
                <h2 className="cta__title" id="cta-title">
                  Start free. Stay free.
                </h2>
                <p className="cta__sub">
                  DYNAMIC ships entirely on Cloudflare&apos;s free tier: 100k requests a day, 5 GB
                  of D1 storage and unlimited static asset requests. Deploy your own in minutes and
                  keep your data yours.
                </p>
                <div className="cta__actions">
                  <a className="button button--light" href={REPO} target="_blank" rel="noreferrer">
                    Deploy your own
                  </a>
                  <a className="button button--on-color" href={APP_URL}>
                    Explore the console
                  </a>
                </div>
              </div>
            </section>
          </div>
        </section>

        {/* -------------------------------- signal ----------------------------- */}
        <section className="signal" aria-labelledby="signal-title">
          <DataRain fullscreen={false} />
          <div className="container signal__inner">
            <div className="signal__panel" data-reveal>
              <p className="signal__tag">The signal</p>
              <h2 className="signal__title" id="signal-title">
                Every event, in flight.
              </h2>
              <p className="signal__text">
                The SDK batches pageviews, Web Vitals and custom events. The Worker validates
                every payload, drops anything personal and writes the rest to D1 at the edge — no
                cookies, no sampling, no third parties.
              </p>
              <div className="signal__actions">
                <a className="signal__link" href={`${REPO}#collect-api`} target="_blank" rel="noreferrer">
                  Read the API <ArrowRight size={15} strokeWidth={2.2} aria-hidden />
                </a>
                <a className="signal__link" href="/demo">
                  Open the console <ArrowRight size={15} strokeWidth={2.2} aria-hidden />
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* -------------------------------- footer ---------------------------- */}
      <HalftoneWordmarkFooter
        className="footer-halftone"
        wordmark={compact ? "" : "dynamic"}
        label="DYNAMIC"
        meta="©2026 · Open source under MIT · Built on Cloudflare Workers"
        columns={FOOTER_COLUMNS}
        preset="night"
        palette={{ background: "#081827", ink: "#f2f8ff", warm: "#23d8ca" }}
        dotGap={6}
        radius={90}
        crop={0.18}
        grain={0.32}
        fontFamily='"Montserrat", "Helvetica Neue", Arial, sans-serif'
        fontWeight={700}
        monoFamily='"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace'
        height={compact ? "auto" : "480px"}
      />

      {/* Live chat: a desktop only, it opens by itself. */}
      <SupportChat />
    </div>
  );
}
