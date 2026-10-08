/**
 * Source-level checks for GoogleButton — proves it calls the REAL
 * next-auth signIn('google', ...), never a mock/fake handler, and that
 * the button itself follows Google's own branding guidelines (light/
 * white background, not ADKSY's Ink/Signal colors) while the rest of
 * the page around it stays ADKSY. renderToStaticMarkup (the other test
 * in this directory) cannot simulate a click — no jsdom — so the actual
 * signIn('google') call site is verified here instead.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

const source = fs.readFileSync(path.join(process.cwd(), 'src/components/auth/GoogleButton.tsx'), 'utf-8');

describe('GoogleButton source', () => {
  it('imports the real next-auth/react signIn, never a local/mock implementation', () => {
    expect(source).toContain("import { signIn } from 'next-auth/react'");
  });

  it('invokes signIn with the "google" provider id', () => {
    expect(source).toMatch(/signIn\(\s*['"]google['"]/);
  });

  it('button background follows Google branding guidelines — white, not ADKSY Ink/Signal', () => {
    expect(source).toContain('bg-white');
    expect(source).not.toContain('bg-[#14161A]');
    expect(source).not.toContain('bg-[#FF5A1F]');
  });

  it('has a loading state and an error message path', () => {
    expect(source).toContain('loading');
    expect(source).toContain('setError');
    expect(source).toContain("role=\"alert\"");
  });
});
