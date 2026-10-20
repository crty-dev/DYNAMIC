import { Atom, Braces, Cloud, Database, Flame, Gauge, Scale, Zap, type LucideIcon } from "lucide-react";

export type StackKey =
  | "workers"
  | "react"
  | "typescript"
  | "hono"
  | "d1"
  | "vitals"
  | "vite"
  | "mit";

export type StackItem = {
  key: StackKey;
  label: string;
  Icon: LucideIcon;
  /** Tailwind class for the icon tint. */
  tint: string;
  /** Beam curvature and the vertical offset of the beam end. */
  curve: number;
  endYOffset: number;
  /** The right hand column draws the beam towards the centre. */
  reverse?: boolean;
};

/** The open technology the project is built on. */
export const STACK: StackItem[] = [
  {
    key: "workers",
    label: "Cloudflare Workers",
    Icon: Cloud,
    tint: "text-[#f6821f]",
    curve: -55,
    endYOffset: -14,
  },
  {
    key: "react",
    label: "React",
    Icon: Atom,
    tint: "text-[#61dafb]",
    curve: -20,
    endYOffset: -6,
  },
  {
    key: "typescript",
    label: "TypeScript",
    Icon: Braces,
    tint: "text-[#3178c6]",
    curve: 20,
    endYOffset: 6,
  },
  {
    key: "hono",
    label: "Hono",
    Icon: Flame,
    tint: "text-[#e05c2b]",
    curve: 55,
    endYOffset: 14,
  },
  {
    key: "d1",
    label: "Cloudflare D1",
    Icon: Database,
    tint: "text-[#5865f2]",
    curve: -55,
    endYOffset: -14,
    reverse: true,
  },
  {
    key: "vitals",
    label: "web-vitals",
    Icon: Gauge,
    tint: "text-[#16a34a]",
    curve: -20,
    endYOffset: -6,
    reverse: true,
  },
  {
    key: "vite",
    label: "Vite",
    Icon: Zap,
    tint: "text-[#a855f7]",
    curve: 20,
    endYOffset: 6,
    reverse: true,
  },
  {
    key: "mit",
    label: "MIT License",
    Icon: Scale,
    tint: "text-[color:var(--muted)]",
    curve: 55,
    endYOffset: 14,
    reverse: true,
  },
];
