import { useEffect, useState, type RefObject } from "react";

/**
 * Adds `.is-visible` to every [data-reveal] element as it enters the
 * viewport, driving the reveal-on-scroll system (see landing.css).
 */
export function useReveal() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      document.querySelectorAll("[data-reveal]").forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -48px 0px" },
    );
    document.querySelectorAll("[data-reveal]").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
}

const reduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Tracks a media query. Used for layout decisions that CSS alone cannot
 * make (e.g. the halftone footer needs a different canvas height per
 * breakpoint, and the height is an inline canvas dimension).
 */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/**
 * Hero mousemove parallax. Smoothly writes normalized pointer position
 * into `--mx` / `--my` custom properties (range -0.5..0.5) on the hero
 * element; CSS derives the transforms. No-ops on touch & reduced motion.
 */
export function useHeroParallax(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || reduced()) return;
    let raf = 0;
    let x = 0;
    let y = 0;
    const target = { x: 0, y: 0 };

    const loop = () => {
      raf = 0;
      x += (target.x - x) * 0.075;
      y += (target.y - y) * 0.075;
      el.style.setProperty("--mx", x.toFixed(4));
      el.style.setProperty("--my", y.toFixed(4));
      // Settle once the pointer stops: no idle animation frame loop.
      if (Math.abs(target.x - x) > 0.0004 || Math.abs(target.y - y) > 0.0004) {
        raf = requestAnimationFrame(loop);
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerType === "touch") return;
      const r = el.getBoundingClientRect();
      target.x = (ev.clientX - r.left) / r.width - 0.5;
      target.y = (ev.clientY - r.top) / r.height - 0.5;
      schedule();
    };
    const onLeave = () => {
      target.x = 0;
      target.y = 0;
      schedule();
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref]);
}

export { reduced as prefersReducedMotion };
