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
});
