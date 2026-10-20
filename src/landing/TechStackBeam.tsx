"use client";

import { forwardRef, useRef, type RefObject } from "react";
import { AnimatedBeam } from "../components/ui/animated-beam";
import { cn } from "../lib/utils";
import { STACK, type StackKey } from "./stack";
import brandMark from "../../images/png-to-webp/logo-removebg-preview.webp";

/**
 * The DYNAMIC stack, drawn as a diagram: the SDK in the middle, the open
 * technology around it. The beam colours follow the brand palette (teal to
 * blue) and stay subtle - no neon glow.
 */

const Circle = forwardRef<
  HTMLDivElement,
  { className?: string; children?: React.ReactNode }
>(({ className, children }, ref) => (
  <div
    ref={ref}
    className={cn(
      "z-10 flex size-10 shrink-0 items-center justify-center rounded-full border border-[color:var(--line)] bg-[color:var(--ink-deep)] p-2 sm:size-12 sm:p-3",
      className,
    )}
  >
    {children}
  </div>
));

Circle.displayName = "Circle";

const LEFT = STACK.slice(0, 4);
const RIGHT = STACK.slice(4);

export default function TechStackBeam() {
  const containerRef = useRef<HTMLDivElement>(null);
  const centerRef = useRef<HTMLDivElement>(null);
  const refs = {
    workers: useRef<HTMLDivElement>(null),
    react: useRef<HTMLDivElement>(null),
    typescript: useRef<HTMLDivElement>(null),
    hono: useRef<HTMLDivElement>(null),
    d1: useRef<HTMLDivElement>(null),
    vitals: useRef<HTMLDivElement>(null),
    vite: useRef<HTMLDivElement>(null),
    mit: useRef<HTMLDivElement>(null),
  } satisfies Record<StackKey, RefObject<HTMLDivElement | null>>;

  const beam = {
    containerRef,
    toRef: centerRef,
    pathColor: "rgba(35, 216, 202, 0.4)",
    pathWidth: 1.5,
    pathOpacity: 0.16,
    gradientStartColor: "#23d8ca",
    gradientStopColor: "#1d70fd",
  } as const;

  return (
    <div
      className="relative flex w-full items-center justify-center overflow-hidden rounded-xl border border-[color:var(--line)] bg-[color:var(--ink-deep)] px-3 py-10 sm:px-10"
      ref={containerRef}
    >
      <div className="grid w-full max-w-3xl grid-cols-[1fr_auto_1fr] items-center gap-x-2 gap-y-8 sm:gap-x-10 sm:gap-y-10">
        <ul className="flex flex-col gap-8 sm:gap-10">
          {LEFT.map((item) => (
            <li
              key={item.key}
              className="flex flex-col items-center gap-1.5 sm:flex-row sm:justify-end sm:gap-3"
            >
              <span className="order-2 max-w-[7.5rem] text-center text-[10px] leading-tight text-[color:var(--muted)] sm:order-1 sm:max-w-none sm:text-right sm:text-sm">
                {item.label}
              </span>
              <Circle ref={refs[item.key]}>
                <item.Icon size={20} className={item.tint} aria-hidden />
              </Circle>
            </li>
          ))}
        </ul>

        <div className="flex flex-col items-center gap-3">
          <Circle
            ref={centerRef}
            className="size-16 border-[color:var(--line-strong)] bg-[color:var(--ink)] p-3 sm:size-20 sm:p-4"
          >
            <img src={brandMark} alt="" width={48} height={48} className="h-full w-full" />
          </Circle>
          <span className="text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--faint)]">
            Dynamic SDK
          </span>
        </div>

        <ul className="flex flex-col gap-8 sm:gap-10">
          {RIGHT.map((item) => (
            <li
              key={item.key}
              className="flex flex-col items-center gap-1.5 sm:flex-row sm:gap-3"
            >
              <Circle ref={refs[item.key]}>
                <item.Icon size={20} className={item.tint} aria-hidden />
              </Circle>
              <span className="order-2 max-w-[7.5rem] text-center text-[10px] leading-tight text-[color:var(--muted)] sm:order-1 sm:max-w-none sm:text-left sm:text-sm">
                {item.label}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {STACK.map((item) => (
        <AnimatedBeam
          key={item.key}
          {...beam}
          fromRef={refs[item.key]}
          curvature={item.curve}
          endYOffset={item.endYOffset}
          reverse={item.reverse}
        />
      ))}
    </div>
  );
}
