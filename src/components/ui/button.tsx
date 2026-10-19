import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dyn-blue disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-to-r from-dyn-blue to-dyn-teal text-white shadow hover:opacity-90",
        outline:
          "border border-white/15 bg-transparent text-slate-200 hover:bg-white/5 hover:text-white",
        ghost: "text-slate-300 hover:bg-white/5 hover:text-white",
        link: "text-dyn-sky underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-5",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  if (asChild) {
    // Basit children-through: tek <a>/<button> çocuk desteklenir (v1).
    const child = React.Children.toArray(props.children)[0] as React.ReactElement;
    return React.cloneElement(child, {
      className: cn(buttonVariants({ variant, size }), className),
    } as Partial<React.ReactElement>);
  }
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { Button, buttonVariants };
