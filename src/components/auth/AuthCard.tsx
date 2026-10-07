import { Logo } from '@/components/UI/Logo';

interface AuthCardProps {
  title: string;
  subtitle?: string;
  /** The page's own form/content — AuthCard owns none of the auth logic, only the shell around it. */
  children: React.ReactNode;
  /** Secondary content below a divider — e.g. a switch-to-other-auth-page link, or legal links. */
  footer?: React.ReactNode;
}

/**
 * Shared visual shell for every auth page (login/signup/forgot-password/
 * reset-password/verify-email) — structure only (centering, card,
 * background, logo, title), never a form field or a fetch/signIn call.
 * Each page keeps its own state/handlers exactly as before and only
 * wraps its existing JSX in this instead of repeating the same
 * "min-h-screen bg-[#14161A] ... bg-white rounded-lg shadow-lg" markup
 * five times with a slightly different inline logo SVG each time.
 */
export function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <div className="min-h-screen bg-[#14161A] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-md">
        <div className="bg-[#F7F6F2] rounded-2xl shadow-[0_24px_64px_-12px_rgba(0,0,0,0.45)] p-6 sm:p-8">
          <div className="flex justify-center mb-6">
            <Logo size={32} withWordmark className="text-[#14161A]" wordmarkClassName="text-[#14161A]" />
          </div>

          <h1 className="text-2xl font-semibold text-[#14161A] text-center tracking-tight">{title}</h1>
          {subtitle && <p className="text-sm text-gray-600 text-center mt-2">{subtitle}</p>}

          <div className={subtitle ? 'mt-6' : 'mt-8'}>{children}</div>

          {footer && <div className="mt-6 pt-6 border-t border-black/10 text-center">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

export default AuthCard;
