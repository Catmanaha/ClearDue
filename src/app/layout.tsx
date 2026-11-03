import type { Metadata } from 'next';
import './globals.css';
import { IntakeDraftProvider } from '@/components/intake-draft';
export const metadata: Metadata = {
  title: { default: 'ClearDue — Fix the reason. Then get paid.', template: '%s · ClearDue' },
  description: 'Evidence-backed invoice resolution for creative businesses.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body>
        <IntakeDraftProvider>{children}</IntakeDraftProvider>
      </body>
    </html>
  );
}
