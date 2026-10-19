import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";

function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <a href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-dyn-blue to-dyn-teal">
            <Activity className="size-4 text-white" aria-hidden />
          </span>
          <span className="text-white">DYNAMIC</span>
        </a>
        <nav className="hidden gap-6 text-sm text-slate-400 md:flex">
          <a className="transition-colors hover:text-white" href="#features">Features</a>
          <a className="transition-colors hover:text-white" href="#docs">Docs</a>
          <a className="transition-colors hover:text-white" href="#github">GitHub</a>
        </nav>
        <Button asChild variant="default" size="sm">
          <a href="/dashboard" rel="noreferrer">Dashboard'a git</a>
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center px-6 pt-20 pb-24 text-center">
        <span className="rounded-full border border-dyn-blue/40 bg-dyn-navy/40 px-4 py-1 text-xs text-dyn-sky">
          Gizlilik odaklı · cookie yok · üçüncü taraf SaaS yok
        </span>
        <h1 className="mt-6 max-w-3xl text-5xl font-bold leading-tight tracking-tight text-white sm:text-6xl">
          Modern analytics{" "}
          <span className="bg-gradient-to-r from-dyn-blue via-dyn-teal to-dyn-cyan bg-clip-text text-transparent">
            for the modern web
          </span>
        </h1>
        <p className="mt-6 max-w-xl text-lg text-slate-400">
          DYNAMIC, Cloudflare Workers üzerinde çalışan açık kaynak web analitiği ve RUM platformudur.
          Google web-vitals ile gerçek kullanıcı performansını ölçer, veriyi D1'de saklar.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-4">
          <Button asChild>
            <a href="#start">Hemen Başla</a>
          </Button>
          <Button asChild variant="outline">
            <a href="#docs">Dokümanları Oku</a>
          </Button>
        </div>
      </main>

      <footer className="border-t border-white/10 py-6 text-center text-xs text-slate-500">
        <p>DYNAMIC · MIT · %100 ücretsiz katmanlar üzerinde çalışır</p>
      </footer>
    </div>
  );
}

export default App;
