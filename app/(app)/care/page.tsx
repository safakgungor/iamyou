import type { Metadata } from 'next';
import IndexCard from '@/components/index-card';

export const metadata: Metadata = { title: 'Care · iamyou' };

/** The Care tab: the clinician summary, recruiting studies and family mode. */
export default function CarePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-4 px-5 pb-16 pt-6">
      <header className="rise mb-2">
        <p className="label text-cyan-ink">Care</p>
        <h1 className="mt-3 text-[36px] font-light leading-[0.95] tracking-[-0.04em]">
          <span className="block">Ready for</span>
          <span className="block">the visit.</span>
        </h1>
        <p className="mt-4 text-[15px] leading-snug text-muted">
          One page for your doctor, studies recruiting near you, and a way for the people you chose
          to ask how you think.
        </p>
      </header>

      <IndexCard
        href="/summary"
        kicker="Clinician summary"
        title="One page for your doctor"
        text="Only what you chose to share."
        i={1}
      />
      <IndexCard
        href="/trials"
        kicker="Studies near you"
        title="Recruiting in Massachusetts"
        text="For your family's condition, from ClinicalTrials.gov."
        i={2}
      />
      <IndexCard
        href="/family"
        kicker="Family mode"
        title="How you think, in your words"
        text="For the people you named, answered from your vault."
        i={3}
      />
    </main>
  );
}
