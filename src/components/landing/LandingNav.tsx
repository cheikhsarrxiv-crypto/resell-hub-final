'use client';

import { useState } from 'react';
import Link from 'next/link';

const LINKS = [
  { label: 'Products', href: '#product' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Features', href: '#features' },
  { label: 'Pricing', href: '#pricing' },
];

export function LandingNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="fixed top-4 sm:top-6 left-0 right-0 z-40 px-4">
      <nav className="max-w-3xl mx-auto flex items-center justify-between gap-4 rounded-full border border-white/10 bg-white/[0.04] backdrop-blur-xl px-3 sm:px-4 py-2 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
        <Link href="/" className="flex items-center gap-2 pl-1 shrink-0">
          <span className="w-2 h-2 rounded-full bg-[#FF5A1F]" aria-hidden="true" />
          <span className="text-sm font-semibold tracking-tight text-white">ADKSY</span>
        </Link>

        <div className="hidden md:flex items-center gap-1">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-gray-300 hover:text-white transition-colors px-3 py-1.5 rounded-full hover:bg-white/5"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden md:flex items-center gap-2 shrink-0">
          <Link
            href="/login"
            className="text-sm text-gray-300 hover:text-white transition-colors px-3 py-1.5"
          >
            Login
          </Link>
          <Link
            href="/signup"
            className="text-sm font-medium bg-white text-black hover:bg-gray-200 transition-colors rounded-full px-4 py-1.5"
          >
            Get Started
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="md:hidden flex items-center justify-center w-8 h-8 rounded-full text-gray-300 hover:text-white hover:bg-white/5 transition-colors shrink-0"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
        >
          {open ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 2L14 14M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 4H14M2 8H14M2 12H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          )}
        </button>
      </nav>

      {open && (
        <div className="md:hidden max-w-3xl mx-auto mt-2 rounded-2xl border border-white/10 bg-[#0a0a0c]/95 backdrop-blur-xl px-4 py-4 flex flex-col gap-1 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setOpen(false)}
              className="text-sm text-gray-300 hover:text-white transition-colors px-2 py-2.5 rounded-lg hover:bg-white/5"
            >
              {link.label}
            </a>
          ))}
          <div className="h-px bg-white/10 my-1" />
          <Link
            href="/login"
            onClick={() => setOpen(false)}
            className="text-sm text-gray-300 hover:text-white transition-colors px-2 py-2.5"
          >
            Login
          </Link>
          <Link
            href="/signup"
            onClick={() => setOpen(false)}
            className="text-sm font-medium bg-white text-black hover:bg-gray-200 transition-colors rounded-full px-4 py-2.5 text-center mt-1"
          >
            Get Started
          </Link>
        </div>
      )}
    </div>
  );
}
