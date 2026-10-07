import { cn } from '@/lib/utils';

interface LogoProps {
  /** Icon size in px — the wordmark (when shown) scales independently via `wordmarkClassName`. */
  size?: number;
  className?: string;
  /** Renders the "ADKSY" wordmark next to the mark. Off by default — contexts that already show the name elsewhere (e.g. next to a page title) only need the mark. */
  withWordmark?: boolean;
  wordmarkClassName?: string;
}

/**
 * Single source of truth for the ADKSY mark — previously duplicated as
 * slightly different inline SVGs across login/signup/forgot-password/
 * reset-password/verify-email (circle + triangle) and
 * DashboardSidebar/DashboardHeader (triangle only, no circle). This
 * centralizes on the circle+triangle version (the one shown on every
 * current auth page) so every surface this redesign touches renders the
 * exact same mark. The ring stays the fixed Signal Orange brand color;
 * the triangle uses `currentColor` so a caller can place it on either a
 * light (Paper) or dark (Ink) background via its own text color class.
 */
export function Logo({ size = 28, className, withWordmark = false, wordmarkClassName }: LogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 72 72"
        aria-hidden="true"
        className="flex-shrink-0"
      >
        <circle cx="36" cy="36" r="32" fill="none" stroke="#FF5A1F" strokeWidth="6" />
        <path
          d="M24 48 L36 22 L48 48 M29 39 H43"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      {withWordmark && (
        <span className={cn('text-xl font-bold tracking-tight', wordmarkClassName)}>ADKSY</span>
      )}
    </span>
  );
}

export default Logo;
