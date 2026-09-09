'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Drives the hero's scroll-linked fade/zoom via a CSS custom property
 * (--hero-p, 0..1) rather than React state, so scrolling never triggers a
 * re-render — child elements read the variable directly in their own
 * inline style (see .hero-fade / .hero-zoom usage in page.tsx).
 */
export function HeroStage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    let rafId = 0;
    const update = () => {
      const vh = window.innerHeight || 1;
      const progress = Math.min(1, Math.max(0, window.scrollY / vh));
      el.style.setProperty('--hero-p', String(progress));
      rafId = 0;
    };

    const onScroll = () => {
      if (!rafId) rafId = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return (
    <div ref={ref} style={{ ['--hero-p' as string]: 0 }}>
      {children}
    </div>
  );
}
