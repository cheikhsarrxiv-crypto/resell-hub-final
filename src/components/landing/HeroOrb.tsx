'use client';

import { useEffect, useRef } from 'react';

/**
 * Canvas-based "ADKSY engine" visual: a bubble-cluster sphere with a glowing
 * center mark, orbited by a ring of marketplace/process badges. Still plain
 * Canvas 2D + hand-rolled 3D projection (no Three.js) — the previous sparse
 * point-cloud version is replaced with larger, gradient-shaded bubbles for
 * a denser, more "solid" look, and the orbit ring is now real: DOM badges
 * driven every frame from the same rotation/projection math as the canvas,
 * so they move in genuine sync with the sphere instead of sitting static.
 */

interface BubblePoint {
  x: number;
  y: number;
  z: number;
  size: number;
  hue: number;
}

interface OrbitItem {
  label: string;
  kind: 'marketplace' | 'process';
  status: 'live' | 'soon';
}

// Marketplace automation status mirrors the real OAuth integrations in
// src/app/api/marketplace/connect/[marketplace]/route.ts and the adapters
// under src/services/marketplace/adapters/: eBay and Etsy are real, live
// integrations; Depop is blocked pending partner approval; Vinted has no
// public API. The orbit shows the target ecosystem, but "live" vs "soon"
// styling below must stay honest about what's actually automated today.
const ORBIT_ITEMS: OrbitItem[] = [
  { label: 'eBay', kind: 'marketplace', status: 'live' },
  { label: 'Etsy', kind: 'marketplace', status: 'live' },
  { label: 'Sync Engine', kind: 'process', status: 'live' },
  { label: 'Order', kind: 'process', status: 'live' },
  { label: 'Depop', kind: 'marketplace', status: 'soon' },
  { label: 'Vinted', kind: 'marketplace', status: 'soon' },
  { label: 'Fulfillment', kind: 'process', status: 'live' },
  { label: 'Shipped', kind: 'process', status: 'live' },
];

function buildSpherePoints(count: number): BubblePoint[] {
  const points: BubblePoint[] = [];
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = goldenAngle * i;
    const x = Math.cos(theta) * radiusAtY;
    const z = Math.sin(theta) * radiusAtY;
    // Deterministic pseudo-random size jitter (no Math.random needed —
    // this only ever runs client-side in an effect, but keeping it
    // deterministic makes the result reproducible between reloads).
    const jitter = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const size = 0.55 + Math.abs(jitter) * 0.55;
    points.push({ x, y, z, size, hue: Math.abs(jitter) });
  }
  return points;
}

export function HeroOrb() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const orbitRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const isMobile = window.innerWidth < 640;
    const bubbleCount = isMobile ? 90 : 220;
    const bubbles = buildSpherePoints(bubbleCount);

    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = container.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    // ResizeObserver's callback always fires asynchronously (even for its
    // initial notification right after observe()), so by the time this
    // runs, `drawFrame` below is already defined. Redrawing here matters
    // most for reduced-motion mode: without a running rAF loop to repaint
    // afterward, that deferred initial notification would resize the
    // canvas — which clears it — and leave it permanently blank.
    const ro = new ResizeObserver(() => {
      resize();
      drawFrame();
    });
    ro.observe(container);

    let angle = 0;
    let tiltX = 0.28; // constant gentle tilt so the orbit reads as an ellipse
    let tiltTargetX = 0.28;
    let tiltY = 0;
    let tiltTargetY = 0;

    const handlePointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const nx = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2);
      const ny = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2);
      tiltTargetY = Math.max(-1, Math.min(1, nx)) * 0.3;
      tiltTargetX = 0.28 + Math.max(-1, Math.min(1, ny)) * -0.18;
    };
    const handlePointerLeave = () => {
      tiltTargetX = 0.28;
      tiltTargetY = 0;
    };

    if (!reduceMotion && !isMobile) {
      container.addEventListener('pointermove', handlePointerMove);
      container.addEventListener('pointerleave', handlePointerLeave);
    }

    const sphereRadius = () => Math.min(width, height) * 0.26;
    const orbitRadius = () => Math.min(width, height) * 0.46;
    const focal = 460;

    function project(x: number, y: number, z: number, cosA: number, sinA: number) {
      const x1 = x * cosA - z * sinA;
      const z1 = x * sinA + z * cosA;
      const cosX = Math.cos(tiltX);
      const sinX = Math.sin(tiltX);
      const y1 = y * cosX - z1 * sinX;
      const z2 = y * sinX + z1 * cosX;
      return { x1, y1, z2 };
    }

    const drawFrame = () => {
      ctx.clearRect(0, 0, width, height);
      const cx = width / 2;
      const cy = height / 2;
      const r = sphereRadius();
      const orbitR = orbitRadius();

      tiltX += (tiltTargetX - tiltX) * 0.05;
      tiltY += (tiltTargetY - tiltY) * 0.05;

      const cosA = Math.cos(angle + tiltY);
      const sinA = Math.sin(angle + tiltY);

      // --- orbit path (faint ellipse + traveling particles) ---
      const cosXOnly = Math.cos(tiltX);
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, orbitR, orbitR * Math.max(0.25, Math.abs(cosXOnly)), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // --- bubble sphere, painter's algorithm (far to near) ---
      const projectedBubbles = bubbles.map((p) => {
        const { x1, y1, z2 } = project(p.x, p.y, p.z, cosA, sinA);
        const scale = focal / (focal + z2 * r);
        return {
          sx: cx + x1 * r * scale,
          sy: cy + y1 * r * scale,
          depth: z2,
          scale,
          size: p.size,
        };
      });
      projectedBubbles.sort((a, b) => a.depth - b.depth);

      for (const b of projectedBubbles) {
        const depthFactor = (b.depth + 1) / 2; // 0 far .. 1 near
        const radius = (r * 0.16 * b.size + 1.5) * b.scale;
        const cxp = b.sx - radius * 0.3;
        const cyp = b.sy - radius * 0.3;

        const grad = ctx.createRadialGradient(cxp, cyp, radius * 0.1, b.sx, b.sy, radius);
        const base = 18 + depthFactor * 40;
        grad.addColorStop(0, `rgba(${base + 55}, ${base + 55}, ${base + 62}, ${0.55 + depthFactor * 0.35})`);
        grad.addColorStop(0.6, `rgba(${base}, ${base}, ${base + 4}, ${0.5 + depthFactor * 0.35})`);
        grad.addColorStop(1, `rgba(6, 6, 8, ${0.4 + depthFactor * 0.3})`);

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(b.sx, b.sy, Math.max(radius, 0.6), 0, Math.PI * 2);
        ctx.fill();

        if (depthFactor > 0.7) {
          ctx.strokeStyle = `rgba(255,255,255,${(depthFactor - 0.7) * 0.25})`;
          ctx.lineWidth = 0.6;
          ctx.stroke();
        }
      }

      // --- central glow + ADKSY mark, fixed in screen space ---
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.55);
      glow.addColorStop(0, 'rgba(255,255,255,0.22)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
      ctx.fill();

      const markScale = (r * 0.36) / 13;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(markScale, markScale);
      ctx.shadowColor = 'rgba(255,255,255,0.7)';
      ctx.shadowBlur = 14 / markScale;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(-6, 7);
      ctx.lineTo(0, -7);
      ctx.lineTo(6, 7);
      ctx.moveTo(-3, 2.5);
      ctx.lineTo(3, 2.5);
      ctx.stroke();
      ctx.restore();

      // --- orbit badges: same rotation, projected, applied to DOM refs ---
      const n = ORBIT_ITEMS.length;
      for (let i = 0; i < n; i++) {
        const el = orbitRefs.current[i];
        if (!el) continue;
        const itemAngle = (i / n) * Math.PI * 2;
        const ox = Math.cos(itemAngle);
        const oz = Math.sin(itemAngle);
        const { x1, y1, z2 } = project(ox, 0, oz, cosA, sinA);
        const scale = focal / (focal + z2 * orbitR * 0.9);
        const sx = cx + x1 * orbitR * scale;
        const sy = cy + y1 * orbitR * scale;
        const depthFactor = (z2 + 1) / 2;

        // Mobile gets a tighter scale range (still grows/shrinks with depth,
        // just less dramatically) so two adjacent badges both near the
        // front — 45° apart, closest they ever get — don't grow large
        // enough at the same time to overlap on a narrow container.
        const scaleBase = isMobile ? 0.68 : 0.65;
        const scaleRange = isMobile ? 0.22 : 0.55;

        el.style.transform = `translate(-50%, -50%) translate(${sx}px, ${sy}px) scale(${scaleBase + depthFactor * scaleRange})`;
        el.style.opacity = String(0.35 + depthFactor * 0.65);
        el.style.zIndex = String(Math.round(depthFactor * 100) + 5);
      }
    };

    if (reduceMotion) {
      drawFrame();
      return () => {
        ro.disconnect();
      };
    }

    let rafId = 0;
    const speed = isMobile ? 0.0011 : 0.0016;
    const tick = () => {
      angle += speed;
      drawFrame();
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-[320px]">
      <canvas ref={canvasRef} className="absolute inset-0" aria-hidden="true" />
      {ORBIT_ITEMS.map((item, i) => (
        <div
          key={item.label}
          ref={(el) => {
            orbitRefs.current[i] = el;
          }}
          className={`absolute top-0 left-0 flex items-center gap-1 sm:gap-1.5 rounded-full border backdrop-blur-md px-2 py-1 sm:px-3 sm:py-1.5 whitespace-nowrap pointer-events-none ${
            item.status === 'live'
              ? 'bg-white/[0.06] border-white/15 text-gray-100'
              : 'bg-white/[0.02] border-white/[0.08] text-gray-500 border-dashed'
          }`}
          style={{ willChange: 'transform, opacity' }}
        >
          {item.kind === 'process' && (
            <span
              className={`w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full ${item.status === 'live' ? 'bg-[#FF5A1F]' : 'bg-gray-600'}`}
              aria-hidden="true"
            />
          )}
          <span className="text-[10px] sm:text-xs font-medium">{item.label}</span>
        </div>
      ))}
    </div>
  );
}
