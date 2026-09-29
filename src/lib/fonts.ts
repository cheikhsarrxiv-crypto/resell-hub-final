import localFont from 'next/font/local';

/**
 * Shared font instances for the ADKSY premium identity — used by the
 * landing page (src/app/page.tsx) and the Dashboard V2 layout
 * (src/app/dashboard/layout.tsx) so both pull from one definition
 * instead of duplicating the font config in each place. Deliberately
 * not loaded in the root layout (src/app/layout.tsx): that would apply
 * it to every route, including pages outside both redesigns' scope.
 *
 * Self-hosted via next/font/local (not next/font/google) — Vercel
 * Production builds failed with
 * `TypeError: Cannot read properties of null (reading '1')` inside
 * @next/font's own Google-fonts loader (loader.js, the line that does
 * `/\.(woff|woff2|eot|ttf|otf)$/.exec(googleFontFileUrl)[1]`): that
 * only throws when the CSS actually fetched from
 * fonts.googleapis.com/fonts.gstatic.com at BUILD TIME didn't contain
 * the expected @font-face font-file URL — i.e. Google Fonts didn't
 * return what next/font/google expects to that specific build request
 * (rate limiting/blocking/transient failure on Vercel's build
 * infrastructure), not a bug in this file's weights/subsets (both were
 * already valid: Space Grotesk 500/700, Inter 400/500/600). Bundling
 * the exact same real font files (downloaded from Google Fonts' own
 * CDN, latin subset, the same weights as before) removes the build-time
 * network dependency entirely, so this can never fail this way again —
 * same font families/weights/`variable` names, so every consumer
 * (`displayFont.variable`/`bodyFont.variable`) is unaffected.
 */
export const displayFont = localFont({
  src: [
    { path: '../fonts/space-grotesk-500.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/space-grotesk-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-display',
  display: 'swap',
});

export const bodyFont = localFont({
  src: [
    { path: '../fonts/inter-400.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/inter-500.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/inter-600.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-body',
  display: 'swap',
});
