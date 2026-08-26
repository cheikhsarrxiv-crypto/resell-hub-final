/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  experimental: {
    appDir: true,
    // Required on Next.js 14.2 for src/instrumentation.ts (register()) to
    // run — that's what actually calls initializeSentry() on boot.
    instrumentationHook: true,
  },
};

module.exports = nextConfig;
