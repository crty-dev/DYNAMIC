import { cn } from "@/lib/utils";

/**
 * A soft radial wash used as a stage light behind a hero element.
 *
 * The original snippet shipped a black → violet (`#63e`) gradient; DYNAMIC
 * keeps the same structure (125% × 125% radial, centred at 50% 10%) but with
 * the brand blue → teal ramp at low opacity, so it reads as depth rather than
 * a neon glow. The gradient is a Tailwind arbitrary background so it can be
 * overridden per instance.
 */
export const HERO_BACKGROUND_CLASS =
  "[background:radial-gradient(55%_55%_at_50%_42%,rgba(29,112,253,0.30)_0%,rgba(35,216,202,0.10)_42%,rgba(11,29,47,0)_62%)]";

export interface HeroBackgroundProps {
  /** Extra class names for the gradient layer. */
  className?: string;
  /** Class names for the wrapper. */
  wrapperClassName?: string;
  /** Optional inline gradient, overrides the Tailwind class. */
  style?: React.CSSProperties;
}

export const Hero = ({
  className,
  wrapperClassName,
  style,
}: HeroBackgroundProps) => {
  return (
    <div className={cn("w-full relative h-full", wrapperClassName)}>
      {/* Background Pattern */}
      <div className="absolute inset-0">
        <div
          className={cn(
            "absolute inset-0 -z-10 h-full w-full items-center px-5 py-24",
            HERO_BACKGROUND_CLASS,
            className,
          )}
          style={style}
        />
      </div>
    </div>
  );
};

export default Hero;
