import { Activity } from "lucide-react";
import { Link } from "react-router";

/**
 * Temporary Console shell — the real dashboard arrives with Phase 4
 * (event ingest + charts on live D1 data). Kept intentionally minimal.
 */
export default function Dashboard() {
  return (
    <div className="min-h-screen bg-dyn-ink text-slate-200">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-dyn-blue to-dyn-teal">
            <Activity className="size-4 text-white" aria-hidden />
          </span>
          DYNAMIC Console
        </span>
        <Link
          to="/"
          className="rounded-full border border-white/10 px-4 py-1.5 text-sm text-slate-400 transition-colors hover:text-white"
        >
          ← Back to site
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-col items-center px-6 pt-20 pb-24 text-center">
        <span className="rounded-full border border-dyn-teal/30 bg-dyn-teal/5 px-4 py-1 text-xs text-dyn-teal">
          Phase 4
        </span>
        <h1 className="mt-6 text-3xl font-bold tracking-tight text-white">
          The Console is being wired to live data.
        </h1>
        <p className="mt-4 max-w-xl text-slate-400">
          Event ingest (<code className="rounded bg-white/5 px-1.5 py-0.5 text-dyn-sky">/api/collect</code>)
          and the first charts land in Phase 4 of the roadmap. Meanwhile the public site is live.
        </p>
      </main>
    </div>
  );
}
