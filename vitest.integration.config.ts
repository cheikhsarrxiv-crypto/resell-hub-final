import { defineConfig } from 'vitest/config';
import path from 'path';

// Separate from vitest.config.ts on purpose: these tests need a real
// PostgreSQL instance and must never run as part of the default `npm
// test`. See tests/integration/stock-service.postgres.test.ts's header
// and scripts/run-stock-integration-tests.sh for setup.
//
// Deliberately does NOT call loadEnv()/dotenv here, unlike
// vitest.config.ts: this suite's whole safety model depends on the
// developer's explicitly-exported DATABASE_URL/DIRECT_URL being the
// final word (checked by src/lib/testing/localDatabaseGuard.ts). Reading
// a .env/.env.local/.env.test file here would risk silently overwriting
// that explicit export with whatever this machine's regular local-dev
// database happens to be — defeating the guard before it even runs. See
// src/lib/testing/__tests__/localDatabaseGuard.test.ts's last test,
// which fails if this file ever re-adds that pattern.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
