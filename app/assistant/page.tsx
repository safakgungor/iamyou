'use client';

/**
 * `app/assistant/page.tsx` — the second self (assistant-tasks Req 1–6).
 *
 * The read-only synthetic inbox on one side, the twin's draft on the other.
 * A reply is drafted by button or by voice ("draft a reply"); both send the
 * same request (Req 3.1, 3.2). The draft then moves through the state machine
 * the server owns: approve, edit, send (simulated) or discard. Nothing leaves
 * without an explicit approve and send (Req 4, 5), and the screen always shows
 * the approval notice and the synthetic label (Req 6.1, 6.2).
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSpeech } from '@/components/use-speech';
import type {
  DraftEventValue,
  DraftResponse,
  InboxMessageResponse,
} from '@/lib/api-schemas';

const APPROVAL_NOTICE = 'Nothing is sent without your approval.';
const VOICE_COMMAND = /\b(draft|reply|respond|answer)\b/i;

type Status =
  | { kind: 'idle' }
  | { kind: 'drafting' }
  | { kind: 'working' }
  | { kind: 'discarded' }
  | { kind: 'error'; message: string };

export default function AssistantPage() {
  const [label, setLabel] = useState('Synthetic data');
  const [messages, setMessages] = useState<InboxMessageResponse[] | null>(null);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const detailRef = useRef<HTMLElement>(null);
  const voiceArmed = useRef(false);
  const speech = useSpeech();

  const selected = messages?.find((m) => m.id === selectedId) ?? null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/assistant/inbox');
        if (!res.ok) throw new Error(`The inbox is unavailable right now (${res.status}).`);
        const data = (await res.json()) as { synthetic_label: string; messages: InboxMessageResponse[] };
        if (cancelled) return;
        setLabel(data.synthetic_label);
        setMessages(data.messages);
        setSelectedId(data.messages[0]?.id ?? null);
      } catch (err) {
        if (!cancelled) setInboxError(err instanceof Error ? err.message : 'The inbox is unavailable right now.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const select = (id: string) => {
    setSelectedId(id);
    setDraft(null);
    setEditing(false);
    setStatus({ kind: 'idle' });
    if (window.matchMedia('(max-width: 899px)').matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  const createDraft = useCallback(async () => {
    if (!selectedId) return;
    setStatus({ kind: 'drafting' });
    setDraft(null);
    setEditing(false);
    try {
      const res = await fetch('/api/assistant/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inbox_message_id: selectedId }),
      });
      if (res.status === 401) throw new Error('Start the demo first: open the app and tap Try as Maya.');
      if (res.status === 502) throw new Error("The twin couldn't write a safe draft this time. Try again.");
      if (!res.ok) throw new Error(`Could not draft a reply (${res.status}).`);
      const data = (await res.json()) as { draft: DraftResponse };
      setDraft(data.draft);
      setStatus({ kind: 'idle' });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Could not draft a reply.' });
    }
  }, [selectedId]);

  // Voice: "draft a reply" (or reply / respond / answer) runs the same request
  // as the button. Armed only by the mic button, so stray speech does nothing.
  useEffect(() => {
    if (!voiceArmed.current || !speech.transcript) return;
    if (VOICE_COMMAND.test(speech.transcript)) {
      voiceArmed.current = false;
      speech.reset();
      void createDraft();
    }
  }, [speech, createDraft]);

  const listen = () => {
    voiceArmed.current = true;
    speech.reset();
    speech.listen();
  };

  async function transition(event: DraftEventValue, body?: string) {
    if (!draft) return;
    setStatus({ kind: 'working' });
    try {
      const res = await fetch('/api/assistant/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body === undefined ? { draft_id: draft.id, event } : { draft_id: draft.id, event, body }),
      });
      if (!res.ok) throw new Error(`That didn't go through (${res.status}). Nothing was sent.`);
      const data = (await res.json()) as { draft: DraftResponse } | { discarded: true };
      if ('discarded' in data) {
        setDraft(null);
        setStatus({ kind: 'discarded' });
      } else {
        setDraft(data.draft);
        setStatus({ kind: 'idle' });
      }
      setEditing(false);
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : 'Something went wrong.' });
    }
  }

  const busy = status.kind === 'drafting' || status.kind === 'working';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-5 pb-16 pt-6 md:px-10">
      <nav className="flex items-center justify-between">
        <Link href="/home" className="label transition-colors hover:text-ink">
          ← Hub
        </Link>
        <span className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
          {label}
        </span>
      </nav>

      <header className="flex flex-col gap-3">
        <p className="label text-cyan-ink">Second self</p>
        <h1 className="text-[clamp(36px,6vw,64px)] font-light leading-[0.95] tracking-[-0.04em]">Your twin writes. You decide.</h1>
        <p className="flex items-center gap-2 text-[15px] text-ink">
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_0_4px_rgb(54_209_240/0.2)]" />
          {APPROVAL_NOTICE}
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Inbox */}
        <section aria-labelledby="inbox-heading" className="flex flex-col gap-3">
          <h2 id="inbox-heading" className="label">
            Inbox{messages ? ` · ${messages.length}` : ''}
          </h2>

          {inboxError && (
            <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {inboxError}
            </p>
          )}
          {!messages && !inboxError && <p className="text-sm text-muted">Loading the inbox…</p>}

          <ul className="flex flex-col gap-2">
            {messages?.map((m) => {
              const active = m.id === selectedId;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => select(m.id)}
                    aria-current={active ? 'true' : undefined}
                    className={`glass flex w-full flex-col gap-1 px-5 py-4 text-left transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 ${
                      active ? 'ring-2 ring-cyan-ink/40' : ''
                    }`}
                  >
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[15px] font-medium">{m.from}</span>
                      <span className="label shrink-0 text-[10px]">{m.relative_time_label}</span>
                    </span>
                    <span className="text-[15px]">{m.subject}</span>
                    <span className="line-clamp-1 text-sm text-muted">{m.body}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Message + draft */}
        <section ref={detailRef} aria-live="polite" className="order-first flex scroll-mt-6 flex-col gap-4 md:order-none">
          {selected && (
            <article className="glass flex flex-col gap-4 p-6">
              <header className="flex flex-col gap-1">
                <span className="label">{selected.relative_time_label} · From</span>
                <span className="text-lg font-medium">{selected.from}</span>
                <span className="text-[15px] text-muted">{selected.subject}</span>
              </header>
              <p className="text-[15px] leading-relaxed">{selected.body}</p>

              {!draft && status.kind !== 'drafting' && (
                <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
                  <button
                    type="button"
                    onClick={createDraft}
                    disabled={busy}
                    className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-[15px] font-medium text-white transition-colors hover:bg-cyan-ink disabled:opacity-50"
                  >
                    Draft a reply <span aria-hidden="true">→</span>
                  </button>
                  {speech.supported && (
                    <button
                      type="button"
                      onClick={listen}
                      disabled={busy || speech.listening}
                      className="inline-flex h-11 items-center gap-2 rounded-full bg-white/70 px-4 text-[15px] shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-white disabled:opacity-60"
                    >
                      <MicIcon />
                      {speech.listening ? 'Listening… say "draft a reply"' : 'Ask by voice'}
                    </button>
                  )}
                </div>
              )}
            </article>
          )}

          {status.kind === 'drafting' && (
            <div className="glass flex items-center gap-3 p-6">
              <span aria-hidden="true" className="h-2.5 w-2.5 animate-ping rounded-full bg-cyan" />
              <span className="text-[15px]">Drafting in Maya&apos;s voice…</span>
            </div>
          )}

          {status.kind === 'discarded' && (
            <div className="glass flex flex-wrap items-center justify-between gap-3 p-6">
              <span className="text-[15px]">Draft discarded. Nothing was sent.</span>
              <button type="button" onClick={createDraft} className="label text-cyan-ink hover:text-ink">
                Draft again →
              </button>
            </div>
          )}

          {status.kind === 'error' && (
            <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {status.message}
            </p>
          )}

          {draft && (
            <article className="glass flex flex-col gap-4 p-6" aria-label="Draft reply">
              <header className="flex items-center justify-between gap-3">
                <span className="label">Draft in Maya&apos;s voice</span>
                <StateBadge state={draft.state} />
              </header>

              {editing ? (
                <textarea
                  aria-label="Edit the draft"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={5}
                  maxLength={2000}
                  className="w-full rounded-2xl bg-white/80 p-4 text-[16px] leading-relaxed shadow-[inset_0_0_0_1px_var(--color-line)] outline-none focus:shadow-[inset_0_0_0_2px_var(--color-cyan-ink)]"
                />
              ) : (
                <p className="whitespace-pre-line rounded-2xl bg-white/70 p-4 text-[16px] leading-relaxed shadow-[inset_0_0_0_1px_var(--color-line)]">
                  {draft.body}
                </p>
              )}

              {draft.state === 'sent' ? (
                <p className="text-sm text-muted">
                  Sent {draft.sent_at ? new Date(draft.sent_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}.
                  This demo records the send and contacts no one.
                </p>
              ) : editing ? (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => transition('edit', editText.trim())}
                    disabled={busy || editText.trim().length === 0}
                    className="inline-flex h-11 items-center rounded-full bg-ink px-5 text-[15px] font-medium text-white transition-colors hover:bg-cyan-ink disabled:opacity-50"
                  >
                    Save edit
                  </button>
                  <button type="button" onClick={() => setEditing(false)} className="label hover:text-ink">
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  {draft.state === 'draft' && (
                    <button
                      type="button"
                      onClick={() => transition('approve')}
                      disabled={busy}
                      className="inline-flex h-11 items-center rounded-full bg-ink px-5 text-[15px] font-medium text-white transition-colors hover:bg-cyan-ink disabled:opacity-50"
                    >
                      Approve
                    </button>
                  )}
                  {draft.state === 'approved' && (
                    <button
                      type="button"
                      onClick={() => transition('send')}
                      disabled={busy}
                      className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-[15px] font-medium text-white transition-colors hover:bg-cyan-ink disabled:opacity-50"
                    >
                      Send <span aria-hidden="true">→</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditText(draft.body);
                      setEditing(true);
                    }}
                    disabled={busy}
                    className="inline-flex h-11 items-center rounded-full bg-white/70 px-5 text-[15px] shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-white disabled:opacity-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => transition('discard')}
                    disabled={busy}
                    className="label ml-auto text-red-700/80 hover:text-red-700"
                  >
                    Discard
                  </button>
                </div>
              )}

              <p className="label text-[10px]">{APPROVAL_NOTICE}</p>
            </article>
          )}
        </section>
      </div>
    </main>
  );
}

function StateBadge({ state }: { state: DraftResponse['state'] }) {
  const text = { draft: 'Draft', approved: 'Approved', sent: 'Sent', discarded: 'Discarded' }[state];
  const tone =
    state === 'approved'
      ? 'bg-cyan/15 text-cyan-ink'
      : state === 'sent'
        ? 'bg-ink text-white'
        : 'text-muted shadow-[inset_0_0_0_1px_var(--color-line)]';
  return (
    <span className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] ${tone}`}>{text}</span>
  );
}

function MicIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
