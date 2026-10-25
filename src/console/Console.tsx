/**
 * DYNAMIC Console.
 *
 * The shell (fixed sidebar with grouped navigation, sticky header with search
 * and range switcher, widget grid, table styling) is adapted from Flatlogic's
 * "react-dashboard" admin template — Copyright (c) 2015-present Flatlogic, LLC,
 * MIT licensed. See NOTICE for the full attribution.
 */
import { useMemo, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router";
import {
  Activity,
  BarChart3,
  Gauge,
  ListTree,
  Menu,
  MousePointerClick,
  Search,
  Settings,
  X,
} from "lucide-react";
import logoMarkPng from "../../images/png-to-webp/logo-removebg-preview.webp";
import { Analytics, Events, Overview, Pages, Rum, Settings as SettingsPage } from "./pages";
import CloudinaryImage from "../components/ui/cloudinary-image";
import { CLOUDINARY_ASSETS } from "../lib/cloudinary";
import {
  ConsoleContext,
  RANGE_LABELS,
  useAnalytics,
  useRum,
  type StatsRange,
} from "./stats";
import "./console.css";

type NavItem = {
  to: string;
  label: string;
  icon: typeof Activity;
  end?: boolean;
};

const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Console",
    items: [{ to: "/demo", label: "Console", icon: BarChart3, end: true }],
  },
  {
    title: "Analytics",
    items: [
      { to: "/demo/analytics", label: "Traffic", icon: Activity },
      { to: "/demo/events", label: "Events", icon: MousePointerClick },
    ],
  },
  {
    title: "Performance",
    items: [{ to: "/demo/rum", label: "Web Vitals", icon: Gauge }],
  },
  {
    title: "Data",
    items: [{ to: "/demo/pages", label: "Pages", icon: ListTree }],
  },
  {
    title: "System",
    items: [{ to: "/demo/settings", label: "Settings", icon: Settings }],
  },
];

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  "/demo": {
    title: "Console",
    subtitle:
      "Everything your site collected in the selected window — visitors, pageviews and Web Vitals, straight from D1.",
  },
  "/demo/analytics": {
    title: "Traffic",
    subtitle:
      "Visitors and pageviews over time, with the paths and countries that produced them.",
  },
  "/demo/rum": {
    title: "Web Vitals",
    subtitle:
      "LCP, INP, CLS, FCP and TTFB collected with web-vitals, plus the pages that need attention first.",
  },
  "/demo/events": {
    title: "Event stream",
    subtitle: "The raw ingest as it arrives. Search by path, metric or country.",
  },
  "/demo/pages": {
    title: "Pages",
    subtitle: "Every path that reported a pageview, ranked by traffic.",
  },
  "/demo/settings": {
    title: "Settings",
    subtitle: "Site keys, collection endpoints and the privacy defaults that ship with DYNAMIC.",
  },
};

function BrandMark() {
  return (
    <CloudinaryImage
      className="console__brand-mark"
      publicId={CLOUDINARY_ASSETS.logo}
      fallbackSrc={logoMarkPng}
      width={30}
      height={30}
      loading="eager"
    />
  );
}

export default function Console() {
  const [range, setRange] = useState<StatsRange>("7d");
  const [query, setQuery] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const analyticsQuery = useAnalytics(range);
  const rumQuery = useRum(range);
  const analytics = analyticsQuery.data;

  const meta = PAGE_META[location.pathname] ?? PAGE_META["/demo"];
  const site = analytics?.site ?? null;

  const value = useMemo(
    () => ({
      range,
      setRange,
      analytics,
      rum: rumQuery.data,
      isLoading: analyticsQuery.isLoading,
      isError: analyticsQuery.isError,
      isFetching: analyticsQuery.isFetching,
      query,
      setQuery,
    }),
    [
      range,
      analytics,
      rumQuery.data,
      analyticsQuery.isLoading,
      analyticsQuery.isError,
      analyticsQuery.isFetching,
      query,
    ],
  );

  return (
    <ConsoleContext.Provider value={value}>
      <div className="console">
        <div className="console__shell">
          <aside className={navOpen ? "console__sidebar is-open" : "console__sidebar"}>
            <div className="console__brand">
              <BrandMark />
              <span className="console__brand-text">
                <b>DYNAMIC</b>
                <span>Console</span>
              </span>
            </div>

            <nav className="console__nav" aria-label="Console">
              {NAV_GROUPS.map((group) => (
                <div className="console__group" key={group.title}>
                  <p className="console__group-title">{group.title}</p>
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      onClick={() => setNavOpen(false)}
                      className={({ isActive }) =>
                        isActive ? "console__link is-active" : "console__link"
                      }
                    >
                      <item.icon size={16} strokeWidth={1.9} aria-hidden />
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              ))}
            </nav>

            <div className="console__sidebar-foot">
              <b>{site ? site.name : "No site yet"}</b>
              {site ? site.origin : "Send your first event to register a site."}
            </div>
          </aside>

          <div className="console__main">
            <header className="console__header">
              <button
                type="button"
                className="console__toggle"
                aria-expanded={navOpen}
                aria-label="Toggle console navigation"
                onClick={() => setNavOpen((open) => !open)}
              >
                {navOpen ? <X size={18} /> : <Menu size={18} />}
              </button>

              <label className="console__search">
                <Search size={15} aria-hidden />
                <input
                  type="search"
                  value={query}
                  placeholder="Search paths, metrics, countries"
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label="Search events"
                />
              </label>

              <div className="console__header-actions">
                <span className={analyticsQuery.isFetching ? "console__live is-stale" : "console__live"}>
                  <i aria-hidden />
                  {analyticsQuery.isFetching ? "Syncing" : "Live"}
                </span>

                <div className="console__range" role="group" aria-label="Time range">
                  {(Object.keys(RANGE_LABELS) as StatsRange[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={range === key ? "is-active" : undefined}
                      onClick={() => setRange(key)}
                    >
                      {RANGE_LABELS[key]}
                    </button>
                  ))}
                </div>

                <a className="console__ghost" href="/">
                  ← Site
                </a>
              </div>
            </header>

            <main className="console__content">
              <p className="console__crumbs">
                You are here <span aria-hidden>›</span> <b>{meta.title}</b>
              </p>
              <h1 className="console__title">{meta.title}</h1>
              <p className="console__subtitle">{meta.subtitle}</p>

              <Routes>
                <Route index element={<Overview />} />
                <Route path="analytics" element={<Analytics />} />
                <Route path="rum" element={<Rum />} />
                <Route path="events" element={<Events />} />
                <Route path="pages" element={<Pages />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="*" element={<Overview />} />
              </Routes>
            </main>
          </div>
        </div>
      </div>
    </ConsoleContext.Provider>
  );
}
