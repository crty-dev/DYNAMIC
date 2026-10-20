import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { prefersReducedMotion } from "./hooks";

type Tok = { t: string; c: string };
type Char = { ch: string; c: string; li: number };

/* Token classes → .tok--* in landing.css */
const KW = "kw";
const STR = "str";
const FN = "fn";
const PROP = "prop";
const COM = "com";
const PL = "pl";

const CODE: Tok[][] = [
  [
    { t: "import", c: KW },
    { t: " { dynamic } ", c: PL },
    { t: "from", c: KW },
    { t: ' "@dynamic/sdk";', c: STR },
  ],
  [],
  [
    { t: "dynamic", c: FN },
    { t: ".", c: PL },
    { t: "init", c: FN },
    { t: "({ ", c: PL },
    { t: "site", c: PROP },
    { t: ": ", c: PL },
    { t: '"yoursite.dev"', c: STR },
    { t: ", ", c: PL },
    { t: "vitals", c: PROP },
    { t: ": ", c: PL },
    { t: "true", c: KW },
    { t: " });", c: PL },
  ],
  [],
  [
    { t: "dynamic", c: FN },
    { t: ".", c: PL },
    { t: "track", c: FN },
    { t: "(", c: PL },
    { t: '"signup"', c: STR },
    { t: ", { ", c: PL },
    { t: "plan", c: PROP },
    { t: ": ", c: PL },
    { t: '"free"', c: STR },
    { t: " });", c: PL },
  ],
  [
    { t: "// → 202 Accepted — cookieless, in D1", c: COM },
  ],
];

/**
 * Self-typing code block: reveals the snippet character by character once it
 * scrolls into view, with a blinking caret and a highlighted "live" line.
 * Renders the finished snippet immediately under prefers-reduced-motion.
 */
export default function TypewriterCode() {
  const ref = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [count, setCount] = useState(() => (prefersReducedMotion() ? Number.POSITIVE_INFINITY : 0));

  const flat = useMemo<Char[]>(() => {
    const arr: Char[] = [];
    CODE.forEach((toks, li) =>
      toks.forEach(({ t, c }) => {
        for (const ch of t) arr.push({ ch, c, li });
      }),
    );
    return arr;
  }, []);
  const total = flat.length;

  const lines = useMemo(() => {
    const buckets: Char[][] = Array.from({ length: CODE.length }, () => []);
    for (const ch of flat) buckets[ch.li].push(ch);
    return buckets.map((chars, li) => ({ li, chars }));
  }, [flat]);

  // begin typing when the block scrolls into view
  useEffect(() => {
    if (started || prefersReducedMotion()) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setStarted(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setStarted(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started || prefersReducedMotion()) return;
    const id = window.setInterval(() => setCount((v) => v + 2), 18);
    return () => window.clearInterval(id);
  }, [started]);

  const n = Math.min(count, total);
  const typing = n < total;
  const liveLine = n === 0 ? 0 : flat[Math.min(n, total) - 1].li;

  const els: ReactNode[] = [];
  let used = 0;
  for (const { li, chars } of lines) {
    const visible = Math.max(0, Math.min(chars.length, n - used));
    used += chars.length;
    const runs: { c: string; text: string }[] = [];
    for (const ch of chars.slice(0, visible)) {
      const run = runs[runs.length - 1];
      if (run && run.c === ch.c) run.text += ch.ch;
      else runs.push({ c: ch.c, text: ch.ch });
    }
    const cls = ["code__line"];
    if (typing && li === liveLine) cls.push("code__line--now");
    els.push(
      <span key={li} className={cls.join(" ")}>
        {runs.map((r, i) => (
          <span key={i} className={`tok--${r.c}`}>
            {r.text}
          </span>
        ))}
        {typing && li === liveLine ? <span className="code__cursor" aria-hidden /> : null}
        {chars.length === 0 ? "\u00A0" : null}
      </span>,
    );
  }

  return (
    <div ref={ref} className="code" role="img" aria-label="DYNAMIC SDK usage example">
      <div className="code__chrome" aria-hidden>
        <span className="code__dot" />
        <span className="code__dot" />
        <span className="code__dot" />
        <span className="code__file">app.ts</span>
      </div>
      <div className="code__body">{els}</div>
    </div>
  );
}
