/**
 * S7 — Node.js 22.20+ and dependency consistency. Offline, read-only: only package.json,
 * package-lock.json and the version files are read.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(__dirname, '../../..');
const require_ = createRequire(path.join(ROOT, 'package.json'));
// semver is a transitive dependency (hoisted by npm), not a declared one: loosely typed on purpose.
const semver = require_('semver') as {
  satisfies: (v: string, r: string, o?: object) => boolean;
  minVersion: (r: string) => { version: string } | null;
  gt: (a: string, b: string) => boolean;
  gte: (a: string, b: string) => boolean;
};
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
const FLOOR = '22.20.0';
const packages = Object.entries(lock.packages as Record<string, any>).filter(([p]) => p !== '');

describe('S7 — declared Node version', () => {
  it('package.json declares engines.node with a floor of exactly 22.20.0', () => {
    expect(pkg.engines?.node).toBe('>=22.20.0');
    expect(semver.minVersion(pkg.engines.node)?.version).toBe(FLOOR);
  });
  it('the lockfile root mirrors it (what npm itself writes)', () => {
    expect(lock.packages[''].engines).toEqual(pkg.engines);
  });
  it('.nvmrc pins the same floor', () => {
    expect(readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim()).toBe(FLOOR);
  });
  it('the Dockerfile no longer builds on Node 18 (below the engines of locked dependencies)', () => {
    const docker = readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8');
    expect(docker).not.toMatch(/node:(16|18|20)\b/);
    expect(docker.match(/^FROM node:22/gm)).toHaveLength(2);
  });
  it('README and QUICK_START state the same floor', () => {
    for (const f of ['README.md', 'QUICK_START.md']) {
      const text = readFileSync(path.join(ROOT, f), 'utf8');
      expect(text).toContain('Node.js 22.20+');
      expect(text).not.toMatch(/Node\.js 18\+/);
    }
  });
  it('the Node running this suite satisfies the declared range', () => {
    expect(semver.satisfies(process.versions.node, pkg.engines.node)).toBe(true);
  });
});

describe('S7 — locked dependencies are compatible with Node 22.20.0', () => {
  it('every locked package that declares engines.node admits 22.20.0', () => {
    const refusing = packages
      .filter(([, i]) => i.engines?.node && !semver.satisfies(FLOOR, i.engines.node, { includePrerelease: true }))
      .map(([p, i]) => `${p}@${i.version} needs ${i.engines.node}`);
    expect(refusing).toEqual([]);
  });
  it('22.20 is the highest minimum any locked package requires (so it is a real floor, not a guess)', () => {
    let max = '0.0.0';
    for (const [, i] of packages) {
      const min = i.engines?.node ? semver.minVersion(i.engines.node)?.version : null;
      if (min && semver.gt(min, max)) max = min;
    }
    expect(max).toBe(FLOOR);
  });
  it('@supabase/supabase-js (production dependency) requires Node >= 22: Node 18/20 images cannot run it', () => {
    expect(lock.packages['node_modules/@supabase/supabase-js'].engines.node).toBe('>=22.0.0');
    expect(semver.satisfies('20.19.0', '>=22.0.0')).toBe(false);
  });
  it('scripts that import a .ts file directly rely on Node type stripping (unflagged since 22.18): the floor covers it', () => {
    const guarded = readFileSync(path.join(ROOT, 'scripts/db/lib/guardedEnv.mjs'), 'utf8');
    expect(guarded).toContain("dbSafetyGuard.ts'");
    expect(semver.gte(FLOOR, '22.18.0')).toBe(true);
  });
});

describe('S7 — package.json / package-lock.json consistency and supply-chain hygiene', () => {
  it('root declarations are identical in both files (dependencies, devDependencies, optionalDependencies)', () => {
    for (const sec of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      expect(lock.packages[''][sec] ?? {}).toEqual(pkg[sec] ?? {});
    }
  });
  it('lockfile v3, every entry resolved from the npm registry with an integrity hash', () => {
    expect(lock.lockfileVersion).toBe(3);
    for (const [p, i] of packages) {
      if (i.link) continue;
      expect(i.resolved?.startsWith('https://registry.npmjs.org/'), p).toBe(true);
      expect(i.integrity, p).toMatch(/^sha(256|384|512)-/);
    }
  });
  it('every direct dependency is locked at a version its declared range accepts', () => {
    for (const sec of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      for (const [name, range] of Object.entries<string>(pkg[sec] ?? {})) {
        const entry = lock.packages[`node_modules/${name}`];
        if (!entry) { expect(sec, `${name} missing from lock`).toBe('optionalDependencies'); continue; }
        expect(semver.satisfies(entry.version, range, { includePrerelease: true }), `${name}@${entry.version} vs ${range}`).toBe(true);
      }
    }
  });
  it('only the known packages run install scripts (prisma engines/client, sentry cli, fsevents)', () => {
    const withScripts = packages.filter(([, i]) => i.hasInstallScript).map(([p]) => p.replace('node_modules/', '')).sort();
    expect(withScripts).toEqual(['@prisma/client', '@prisma/engines', '@sentry/cli', 'fsevents', 'prisma']);
  });
  it('the project\'s own lifecycle script is only `prisma generate`', () => {
    const lifecycle = Object.keys(pkg.scripts).filter((s) => /^(pre|post)?(install|prepare|publish)$/.test(s));
    expect(lifecycle).toEqual(['postinstall']);
    expect(pkg.scripts.postinstall).toBe('prisma generate');
  });
  it('no .npmrc / registry override exists in the repository', () => {
    expect(existsSync(path.join(ROOT, '.npmrc'))).toBe(false);
  });
});
