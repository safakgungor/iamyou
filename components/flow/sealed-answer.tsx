'use client';

/**
 * The twin's answer as a sealed card. Until the user answers, the card shows
 * only redacted lines under a seal: the prediction text is never on the client
 * before the reveal (twin-loop Req 4.5). On reveal the seal lifts, the lines
 * dissolve and the guess rises in next to what the user said. The small twin
 * sphere pulses while the answer is being compared.
 */

import type { CSSProperties, Ref } from 'react';
import TwinPortrait from '@/components/twin-portrait';
import { stagger } from './motion';
import styles from './flow.module.css';

const LINES = ['w-full', 'w-[88%]', 'w-[62%]'];

export default function SealedAnswer({
  ref,
  working,
  prediction,
  answer,
  className = '',
  style,
}: {
  ref?: Ref<HTMLElement>;
  working: boolean;
  prediction?: string;
  answer?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const open = prediction !== undefined;

  return (
    <section
      ref={ref}
      aria-label="The twin's answer"
      aria-live="polite"
      className={`glass relative scroll-mt-16 overflow-hidden p-5 ${className}`}
      style={style}
    >
      <div className="flex items-center gap-3">
        <div className="-my-2 h-14 w-14 shrink-0">
          <TwinPortrait shape="twin" waking={working} count={1500} pointSize={4} />
        </div>
        <p className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="label">{open ? 'The twin guessed' : 'The twin’s answer'}</span>
          <span className="text-[15px] leading-snug">
            {open ? 'Before it saw yours.' : working ? 'Comparing with yours…' : 'Sealed until you answer.'}
          </span>
        </p>
        <span
          key={open ? 'open' : 'sealed'}
          className={`rise shrink-0 rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${
            open ? 'bg-cyan/15 text-cyan-ink' : 'bg-ink text-white'
          }`}
        >
          {open ? 'Open' : 'Sealed'}
        </span>
      </div>

      <div className="mt-4 grid">
        {/* The redacted lines and the seal. They dissolve when the guess arrives. */}
        <div
          aria-hidden="true"
          className={`relative col-start-1 row-start-1 flex flex-col gap-2.5 py-1 transition-[opacity,filter,transform] duration-500 ease-out motion-reduce:transition-none ${
            open ? 'pointer-events-none scale-[1.03] opacity-0 blur-sm' : ''
          }`}
        >
          {LINES.map((w) => (
            <span key={w} className={`h-3 rounded-full ${w} ${working ? styles.shimmer : 'bg-ink/[0.07]'}`} />
          ))}
          <span
            className={`absolute left-1/2 top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-ink text-white shadow-[0_10px_24px_-10px_rgb(24_33_46/0.8)] transition-transform duration-500 motion-reduce:transition-none ${
              open ? 'scale-150' : ''
            }`}
          >
            <LockIcon open={open} />
          </span>
        </div>

        {open && (
          <p className="rise col-start-1 row-start-1 text-[17px] leading-relaxed" style={stagger(3)}>
            {prediction}
          </p>
        )}
      </div>

      {open && answer && (
        <div className="rise mt-4 flex flex-col gap-1 border-t border-line pt-4" style={stagger(5)}>
          <span className="label">You said</span>
          <p className="text-[16px] leading-relaxed text-muted">{answer}</p>
        </div>
      )}
    </section>
  );
}

function LockIcon({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="11" width="14" height="10" rx="2.5" />
      <path
        d={open ? 'M8 11V8a4 4 0 0 1 7.6-1.7' : 'M8 11V8a4 4 0 0 1 8 0v3'}
        className="transition-[d] duration-300"
      />
    </svg>
  );
}
