import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';

export const metadata: Metadata = {
  title: 'ADKSY - One product. One hub.',
  description: 'Manage your reselling business across multiple marketplaces',
};

// viewportFit: 'cover' lets the page draw under the iOS notch/home
// indicator/Dynamic Island instead of leaving a hard safe-area gap —
// required for env(safe-area-inset-bottom) (used by DashboardBottomNav)
// to resolve to a real, non-zero value instead of always 0px.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-50">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
