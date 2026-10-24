'use client';

/**
 * `app/summary/page.tsx` — the clinician summary (care-outputs Req 1–4).
 *
 * One printable page built by `POST /api/summary`, following the 14 fields of
 * `docs/clinician-summary-fields.md` in order and nothing more (Req 1.2). The
 * measures table shows the person's own baseline, their last four weeks and
 * the change as a z-score, with "Not available" for missing values and no
 * target anywhere (Req 2). "What changed" carries details only when the
 * right-not-to-know gate allows it; the server decides (Req 3). The footer is
 * always shown (Req 1.6), and the "Synthetic data" label sits next to the data
 * whenever the server cannot confirm it is real (Req 4.1–4.3).
 *
 * The person may add what they want to discuss and a contact. Both only shape
 * this page: they are not stored and not sent to any model.
 *
 * Printing hides the phone and the controls and fits the page on one sheet
 * (`print.css`, Req 1.1).
 */

import Link from 'next/link';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { MeasureRowResponse, SummaryFieldResponse, SummaryResponse } from '@/lib/api-schemas';
import { NOT_AVAILABLE_TEXT, NO_CHANGE_TEXT } from '@/lib/summary';
import './print.css';

/** Decimals and the unit hint per measure; the values themselves come from the server. */
const MEASURE_FORMAT: Record<MeasureRowResponse['feature'], { decimals: number; unit: string }> = {
  vocabulary_diversity: { decimals: 2, unit: '0 to 1' },
  mean_sentence_length: { decimals: 1, unit: 'words' },
  filler_rate: { decimals: 1, unit: 'per 100 words' },
  sleep_hours: { decimals: 1, unit: 'hours a night' },
  active_minutes: { decimals: 0, unit: 'minutes a week' },
  twin_accuracy: { decimals: 2, unit: '0 to 1' },
};

function formatValue(row: MeasureRowResponse, value: number | null): string {
  return value === null ? NOT_AVAILABLE_TEXT : value.toFixed(MEASURE_FORMAT[row.feature].decimals);
}

/** The stagger step for a `.rise` entrance (app/globals.css). */
const stagger = (i: number) => ({ '--i': i }) as CSSProperties;

function formatZ(z: number | null): string {
  if (z === null) return NOT_AVAILABLE_TEXT;
  const sign = z > 0.05 ? '+' : z < -0.05 ? '−' : '';
  return `${sign}${Math.abs(z).toFixed(1)}`;
}

export default function SummaryPage() {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [discuss, setDiscuss] = useState('');
  const [contact, setContact] = useState('');

  const load = useCallback(async (body: { discuss?: string; contact?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.status === 401) throw new Error('Start the demo first: open the app and tap Try as Maya.');
      if (!res.ok) throw new Error(`The summary is unavailable right now (${res.status}).`);
      setSummary((await res.json()) as SummaryResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The summary is unavailable right now.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load({});
  }, [load]);

  const update = () => {
    const body: { discuss?: string; contact?: string } = {};
    if (discuss.trim()) body.discuss = discuss.trim();
    if (contact.trim()) body.contact = contact.trim();
    void load(body);
  };

  // Until the server confirms the data is real, it is labelled. (Req 4.3)
  const label = summary ? summary.synthetic_label : 'Synthetic data';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-7 px-5 pb-16 pt-6">
      <nav className="flex items-center justify-between print:hidden">
        <Link href="/care" className="label transition-colors hover:text-ink">
          ← Care
        </Link>
        {label && (
          <span className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
            {label}
          </span>
        )}
      </nav>

      <header className="rise flex flex-col gap-3 print:hidden">
        <p className="label text-cyan-ink">Care · Clinician summary</p>
        <h1 className="text-[40px] font-light leading-[0.95] tracking-[-0.04em]">One page for your clinician.</h1>
        <p className="text-[15px] text-muted">Your measures against your own baseline. Print it or bring it to a visit.</p>
      </header>

      <form
        className="glass rise flex flex-col gap-4 p-5 print:hidden"
        style={stagger(1)}
        onSubmit={(e) => {
          e.preventDefault();
          update();
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="label">What you would like to discuss</span>
          <textarea
            value={discuss}
            onChange={(e) => setDiscuss(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="In your own words. Optional."
            className="w-full rounded-2xl bg-white/80 p-3 text-[15px] leading-relaxed shadow-[inset_0_0_0_1px_var(--color-line)] outline-none focus:shadow-[inset_0_0_0_2px_var(--color-cyan-ink)]"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="label">Contact for questions</span>
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            maxLength={200}
            placeholder="Email or phone. Optional."
            className="h-11 w-full rounded-2xl bg-white/80 px-3 text-[15px] shadow-[inset_0_0_0_1px_var(--color-line)] outline-none focus:shadow-[inset_0_0_0_2px_var(--color-cyan-ink)]"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 items-center rounded-full bg-white/70 px-5 text-[15px] shadow-[inset_0_0_0_1px_var(--color-line)] tap hover:bg-white disabled:opacity-50"
          >
            Update the page
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={!summary || loading}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-[15px] font-medium text-white tap hover:bg-cyan-ink disabled:opacity-50"
          >
            Print <span aria-hidden="true">→</span>
          </button>
        </div>
        <p className="label text-[10px]">Used only on this page. Not stored.</p>
      </form>

      {error && (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 print:hidden">
          {error}
        </p>
      )}
      {loading && !summary && <p className="text-sm text-muted print:hidden">Preparing the summary…</p>}

      {summary && <SummaryPaper summary={summary} />}
    </main>
  );
}

/** The printable page: the 14 fields, in order, and nothing else. */
function SummaryPaper({ summary }: { summary: SummaryResponse }) {
  const label = summary.synthetic_label;
  return (
    <article
      aria-label="Clinician summary"
      className="care-summary rise flex flex-col gap-4 rounded-[18px] bg-surface p-5 text-ink shadow-[0_30px_80px_-40px_rgb(24_33_46/0.35),0_0_0_1px_var(--color-line)] print:gap-[7pt]"
    >
      {summary.fields.map((field) => (
        <SummaryFieldView key={field.n} field={field} label={label} />
      ))}
    </article>
  );
}

function SummaryFieldView({ field, label }: { field: SummaryFieldResponse; label: string | null }) {
  if (field.key === 'measures' && 'rows' in field) {
    return (
      <section className="flex flex-col gap-2 border-t border-line pt-3 print:pt-[6pt]">
        <h3 className="flex items-center justify-between gap-3">
          <span className="label text-[10px]">{field.label}</span>
          {label && <SyntheticBadge text={label} />}
        </h3>
        <MeasuresTable rows={field.rows} />
      </section>
    );
  }
  if (!('text' in field)) return null;

  switch (field.key) {
    case 'subject':
      return (
        <header className="flex items-start justify-between gap-3">
          <h2 className="text-[17px] font-medium leading-snug tracking-[-0.01em] print:text-[13pt]">{field.text}</h2>
          {label && <SyntheticBadge text={label} />}
        </header>
      );
    case 'intro':
      return <p className="text-[13px] leading-relaxed text-muted print:text-[9pt]">{field.text}</p>;
    case 'footer':
      return (
        <footer className="border-t border-ink pt-3 text-[15px] font-medium print:pt-[6pt] print:text-[11pt]">
          {field.text}
        </footer>
      );
    default: {
      const changed = field.key === 'what_changed' && field.text !== NO_CHANGE_TEXT;
      return (
        <section
          className={`grid gap-0.5 border-t border-line pt-3 print:grid-cols-[10.5rem_1fr] print:gap-3 print:pt-[6pt] ${
            changed ? 'border-l-2 border-l-cyan-ink pl-3' : ''
          }`}
        >
          <h3 className="label text-[10px] print:text-[7.5pt]">{field.label}</h3>
          <p className="whitespace-pre-line text-[14px] leading-relaxed print:text-[9.5pt] print:leading-snug">{field.text}</p>
        </section>
      );
    }
  }
}

function MeasuresTable({ rows }: { rows: MeasureRowResponse[] }) {
  return (
    <table className="w-full border-collapse text-left text-[13px] print:text-[9pt]">
      <thead>
        <tr className="label text-[9px] print:text-[7pt]">
          <th scope="col" className="pb-1.5 pr-2 font-normal">Measure</th>
          <th scope="col" className="pb-1.5 pr-2 text-right font-normal">Baseline</th>
          <th scope="col" className="pb-1.5 pr-2 text-right font-normal">Last 4 wk</th>
          <th scope="col" className="pb-1.5 text-right font-normal">Change (z)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.feature} className="border-t border-line align-top">
            <th scope="row" className="py-1.5 pr-2 font-normal">
              <span className="block leading-tight">{row.label}</span>
              <span className="block text-[11px] leading-tight text-muted print:text-[7.5pt]">{MEASURE_FORMAT[row.feature].unit}</span>
            </th>
            <td className="py-1.5 pr-2 text-right tabular-nums">{formatValue(row, row.baselineMean)}</td>
            <td className="py-1.5 pr-2 text-right tabular-nums">{formatValue(row, row.recentMean)}</td>
            <td className="py-1.5 text-right tabular-nums">{formatZ(row.z)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SyntheticBadge({ text }: { text: string }) {
  return (
    <span className="shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
      {text}
    </span>
  );
}
