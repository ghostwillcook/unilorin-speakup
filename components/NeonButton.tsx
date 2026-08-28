import type { ButtonHTMLAttributes, ReactNode } from "react";
import Link from "next/link";

type Variant = "solid" | "ghost" | "danger";

/* `solid` is the near-black pill — the one loud element on the page, so a screen
   should carry at most one of it. `ghost` is the quiet hairline default for
   everything else. The exported names still say "neon" because every call site
   imports them; only the styling moved. */
const CLASS: Record<Variant, string> = {
  solid: "btn-primary",
  ghost: "btn-ghost",
  danger: "btn-danger",
};

export default function NeonButton({
  children,
  variant = "solid",
  loading = false,
  className = "",
  disabled,
  ...rest
}: {
  children: ReactNode;
  variant?: Variant;
  loading?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={`${CLASS[variant]} ${className}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}

/** Anchor styled as a button, for navigation rather than actions. */
export function NeonLink({
  href,
  children,
  variant = "solid",
  className = "",
}: {
  href: string;
  children: ReactNode;
  variant?: Variant;
  className?: string;
}) {
  return (
    <Link href={href} className={`${CLASS[variant]} ${className}`}>
      {children}
    </Link>
  );
}

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        strokeOpacity="0.25"
      />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}
