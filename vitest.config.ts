import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import path from 'path';

// Vite only injects .env values into import.meta.env, not process.env —
// Prisma reads process.env.DATABASE_URL/DIRECT_URL directly (env("...") in
// schema.prisma), so without this, any real-DB test (new PrismaClient())
// sees those as undefined and silently treats the DB as unreachable.
Object.assign(process.env, loadEnv('test', process.cwd(), ''));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // tsconfig.json sets "jsx": "preserve" (Next.js's own SWC compiler does
  // the real JSX transform at build time) — Vite's own transform (oxc, in
  // this Vite version) would otherwise inherit that and leave JSX
  // untouched, which fails to parse in Vitest's transform pipeline. This
  // overrides it for Vitest only (no effect on `next build`/`next dev`,
  // and no new dependency: oxc already ships inside vite) so .test.tsx
  // files (e.g. Phase 11A's Agent UI component tests) can render
  // components via react-dom/server's renderToStaticMarkup.
  oxc: {
    jsx: 'react-jsx',
  },
});
