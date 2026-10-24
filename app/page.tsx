import type { Metadata } from 'next';
import sample from '@/data/public/physionet-stress-v1-sample.json';
import Landing from '@/components/landing/landing';
import { buildRealSignal, type StressSample } from '@/components/landing/real-signal-data';

export const metadata: Metadata = {
  title: 'iamyou · I am you',
  description: 'A digital twin that grows with you, thinks like you and works for you.',
  openGraph: {
    title: 'iamyou · I am you',
    description: 'A digital twin that grows with you, thinks like you and works for you.',
    images: ['/landing/film-poster.jpg'],
  },
};

/** The marketing landing. The app itself lives at /app. Fonts come from the root layout. */
export default function LandingPage() {
  // Built on the server so only one session's series reaches the browser.
  const signal = buildRealSignal(sample as StressSample, 'S07');
  return <Landing signal={signal} />;
}
