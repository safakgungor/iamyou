import type { Metadata } from 'next';
import IndexCard from '@/components/index-card';

export const metadata: Metadata = { title: 'Health · iamyou' };

/** The Health tab: the personal baseline timeline and the wrist signal. */
export default function HealthPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 px-5 pb-16 pt-6">
      <header className="rise mb-2">
        <p className="label text-cyan-ink">Health layer</p>
        <h1 className="mt-3 text-[36px] font-light leading-[0.95] tracking-[-0.04em]">
          <span className="block">A baseline,</span>
          <span className="block">while you&apos;re well.</span>
        </h1>
        <p className="mt-4 text-[15px] leading-snug text-muted">
          Your twin keeps a weekly record of your speech, sleep and activity, measured against your
          own normal. You decide who hears about a change.
        </p>
      </header>

      <IndexCard
        href="/timeline"
        kicker="Your timeline"
        title="22 years against your own baseline"
        text="Week by week, ages 18 to 40. Synthetic history."
        i={1}
      />
      <IndexCard
        href="/real-signal"
        kicker="Wrist signal · research data"
        title="Same heart, two reasons"
        text="Our model on real PhysioNet wristband data."
        i={2}
      />

      <p className="rise mt-2 px-1 text-[13px] leading-snug text-muted" style={{ '--i': 3 } as React.CSSProperties}>
        Never a diagnosis. The strongest thing it will say is that you might want to talk to your
        doctor.
      </p>
    </main>
  );
}
