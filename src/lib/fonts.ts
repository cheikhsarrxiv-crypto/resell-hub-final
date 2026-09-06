import { Space_Grotesk, Inter } from 'next/font/google';

/**
 * Shared font instances for the ADKSY premium identity — used by the
 * landing page (src/app/page.tsx) and the Dashboard V2 layout
 * (src/app/dashboard/layout.tsx) so both pull from one definition
 * instead of duplicating the next/font/google config in each place.
 * Deliberately not loaded in the root layout (src/app/layout.tsx):
 * that would apply it to every route, including pages outside both
 * redesigns' scope.
 */
export const displayFont = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-display',
});

export const bodyFont = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-body',
});
