/**
 * The one header pattern for app screens: a back link on the left and the data
 * label pill on the right, then a kicker and a light title. The back link and
 * pill row is a 44px tap row; the entry screen passes its wordmark instead of a
 * back link.
 */

import Link from 'next/link';
import type { ReactNode } from 'react';

export function DataPill({ children = 'Synthetic data' }: { children?: ReactNode }) {
  return (
    <span className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
      {children}
    </span>
  );
}

export function BackLink({ href = '/home', children = '← Today' }: { href?: string; children?: ReactNode }) {
  return (
    <Link href={href} className="label -ml-2 inline-flex h-11 items-center rounded-full px-2 transition-colors hover:text-ink">
      {children}
    </Link>
  );
}

export default function ScreenHeader({
  lead = <BackLink />,
  pill = <DataPill />,
  kicker,
  title,
  titleClassName = 'text-[36px] leading-[0.98]',
  children,
}: {
  lead?: ReactNode;
  pill?: ReactNode;
  kicker: ReactNode;
  title: ReactNode;
  titleClassName?: string;
  children?: ReactNode;
}) {
  return (
    <>
      <nav className="flex h-11 items-center justify-between">
        {lead}
        {pill}
      </nav>
      <header className="flex flex-col gap-3">
        <p className="label text-cyan-ink">{kicker}</p>
        <h1 className={`text-balance font-light tracking-[-0.04em] ${titleClassName}`}>{title}</h1>
        {children}
      </header>
    </>
  );
}
