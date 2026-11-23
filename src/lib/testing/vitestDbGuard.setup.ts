/**
 * Vitest setup file (see vitest.config.ts `setupFiles`): runs before every
 * test file, i.e. before any module-level `new PrismaClient()` or top-level
 * `await prisma.$queryRaw` of the live DB tests can run.
 *
 * Fail-closed: if DATABASE_URL / DIRECT_URL is set to anything other than the
 * dedicated local R3-C database, the whole test file aborts with a
 * DbSafetyError (reason codes only, never the URL). With no DB variable set
 * nothing can connect, so mocked tests run unchanged.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enforceGuardForTestRun } from './dbSafetyGuard';

// The project root comes from this file's own location, never from the current directory,
// so launching Vitest from another directory cannot hide an env file from the scan.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

enforceGuardForTestRun(process.env, projectRoot);
