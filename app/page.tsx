import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Outfit } from 'next/font/google';
import sample from '@/data/public/physionet-stress-v1-sample.json';
import Landing from '@/components/landing/landing';
import { buildRealSignal, type StressSample } from '@/components/landing/real-signal-data';

const display = Outfit({ subsets: ['latin'], weight: ['300', '400', '500'], variable: '--lx-display', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], weight: ['400'], variable: '--lx-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'iamyou · I am you',
  description: 'A digital twin that grows with you, thinks like you and works for you.',
  openGraph: {
    title: 'iamyou · I am you',
    description: 'A digital twin that grows with you, thinks like you and works for you.',
    images: ['/landing/film-poster.jpg'],
  },
};

export const viewport: Viewport = {
  themeColor: '#f4f7fb',
};

/** The marketing landing. The app itself lives at /app. */
export default function LandingPage() {
  // Built on the server so only one session's series reaches the browser.
  const signal = buildRealSignal(sample as StressSample, 'S07');
  return (
    <div className={`${display.variable} ${mono.variable}`}>
      <Landing signal={signal} />
    </div>
  );
}
