import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router";
import LandingPage from "./landing/LandingPage";

// The console pulls in recharts; it is code-split so the public landing page
// never downloads the charting runtime.
const Console = lazy(() => import("./console/Console"));
// The super admin panel is code-split as well - a normal visitor never
// downloads it.
const Admin = lazy(() => import("./admin/Admin"));

function ConsoleFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-dyn-ink text-sm text-slate-400">
      Loading console…
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      {/* Super admin panel: the API checks the role, the route is only the UI. */}
      <Route
        path="/dashboard/*"
        element={
          <Suspense fallback={<ConsoleFallback />}>
            <Admin />
          </Suspense>
        }
      />
      {/* The public product preview (demo data). */}
      <Route
        path="/demo/*"
        element={
          <Suspense fallback={<ConsoleFallback />}>
            <Console />
          </Suspense>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
