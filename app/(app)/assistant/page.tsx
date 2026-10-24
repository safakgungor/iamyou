'use client';

/**
 * `app/assistant/page.tsx` — the second self (assistant-tasks Req 1–6).
 *
 * The read-only synthetic inbox with the selected message on top and the
 * twin's draft under it. A reply is drafted by button or by voice ("draft a
 * reply"); both send the same request (Req 3.1, 3.2). The draft then moves
 * through the state machine the server owns: approve, edit, send (simulated) or
 * discard, and a status track slides draft → approved → sent. Nothing leaves
 * without an explicit approve and send (Req 4, 5), and the screen always shows
 * the approval notice and the synthetic label (Req 6.1, 6.2).
 */

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSpeech } from '@/components/use-speech';
import ScreenHeader, { DataPill } from '@/components/flow/screen-header';
import { stagger } from '@/components/flow/motion';
import styles from '@/components/flow/flow.module.css';
import type {
  DraftEventValue,
  DraftResponse,
  InboxMessageResponse,
} from '@/lib/api-schemas';

const APPROVAL_NOTICE = 'Nothing is sent without your approval.';
const VOICE_COMMAND = /\b(draft|reply|respond|answer)\b/i;

const INK = 'bg-ink font-medium text-white transition-colors hover:bg-cyan-ink disabled:opacity-50';
const PAPER = 'bg-white/70 shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-white disabled:opacity-50';
const PILL = 'tap inline-flex items-center justify-center gap-2 rounded-full';
const PRIMARY = `${PILL} ${INK} h-11 px-5 text-[15px]`;
const SECONDARY = `${PILL} ${PAPER} h-11 px-5 text-[15px]`;
const BIG_PRIMARY = `${PILL} ${INK} h-14 text-[16px]`;
const BIG_SECONDARY = `${PILL} ${PAPER} h-14 text-[16px] font-medium`;
const QUIET = 'tap label inline-flex h-11 items-center rounded-full px-3 transition-colors';

/** A per-message notice: the draft was discarded, or a request failed. */
type Notice = { id: string; kind: 'discarded' } | { id: string; kind: 'error'; message: string };

export default function AssistantPage() {
  const [label, setLabel] = useState('Synthetic data');
  const [messages, setMessages] = useState<InboxMessageResponse[] | null>(null);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Drafts by inbox message id, so a sent reply stays sent while browsing.
  const [drafts, setDrafts] = useState<Record<string, DraftResponse>>({});
  const [draftingId, setDraftingId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const detailRef = useRef<HTMLElement>(null);
  const draftRef = useRef<HTMLDivElement>(null);
  const voiceArmed = useRef(false);
  const speech = useSpeech();

  const selected = messages?.find((m) => m.id === selectedId) ?? null;
  const draft = selectedId ? drafts[selectedId] : undefined;
  const drafting = draftingId !== null && draftingId === selectedId;
  const selectedNotice = notice && notice.id === selectedId ? notice : null;
  const busy = draftingId !== null || working;

  const loadInbox = useCallback(async (signal?: { cancelled: boolean }) => {
    setInboxError(null);
    try {
      const res = await fetch('/api/assistant/inbox');
      if (res.status === 401) throw new Error('Start the demo first: open the app and tap Try as Maya.');
      if (!res.ok) throw new Error('The inbox didn’t load. Give it another try.');
      const data = (await res.json()) as { synthetic_label: string; messages: InboxMessageResponse[] };
      if (signal?.cancelled) return;
      setLabel(data.synthetic_label);
      setMessages(data.messages);
      setSelectedId((id) => id ?? data.messages[0]?.id ?? null);
    } catch (err) {
      if (!signal?.cancelled) setInboxError(err instanceof Error ? err.message : 'The inbox didn’t load.');
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    void loadInbox(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [loadInbox]);

  const select = (id: string) => {
    setSelectedId(id);
    setEditing(false);
    // The message and its draft sit above the list, so bring them into view.
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const revealDraft = () =>
    requestAnimationFrame(() => draftRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));

  const createDraft = useCallback(async () => {
    if (!selectedId) return;
    const id = selectedId;
    setDraftingId(id);
    setNotice(null);
    setEditing(false);
    revealDraft();
    try {
      const res = await fetch('/api/assistant/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inbox_message_id: id }),
      });
      if (res.status === 401) throw new Error('Start the demo first: open the app and tap Try as Maya.');
      if (res.status === 502) throw new Error("The twin couldn't write a safe draft this time. Try again.");
      if (!res.ok) throw new Error('The twin couldn’t draft that one. Try again.');
      const data = (await res.json()) as { draft: DraftResponse };
      setDrafts((d) => ({ ...d, [id]: data.draft }));
      revealDraft();
    } catch (err) {
      setNotice({ id, kind: 'error', message: err instanceof Error ? err.message : 'Could not draft a reply.' });
    } finally {
      setDraftingId(null);
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
    if (!draft || !selectedId) return;
    const id = selectedId;
    setWorking(true);
    setNotice(null);
    try {
      const res = await fetch('/api/assistant/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body === undefined ? { draft_id: draft.id, event } : { draft_id: draft.id, event, body }),
      });
      if (!res.ok) throw new Error('That didn’t go through. Nothing was sent.');
      const data = (await res.json()) as { draft: DraftResponse } | { discarded: true };
      if ('discarded' in data) {
        setDrafts((d) => {
          const next = { ...d };
          delete next[id];
          return next;
        });
        setNotice({ id, kind: 'discarded' });
      } else {
        setDrafts((d) => ({ ...d, [id]: data.draft }));
      }
      setEditing(false);
    } catch (err) {
      setNotice({ id, kind: 'error', message: err instanceof Error ? err.message : 'Something went wrong.' });
    } finally {
      setWorking(false);
    }
  }

  // After a send, offer the next message that has not been sent yet.
  const nextUnsent = messages?.find((m) => m.id !== selectedId && drafts[m.id]?.state !== 'sent') ?? null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-5 pb-24 pt-3">
      <ScreenHeader pill={<DataPill>{label}</DataPill>} kicker="Second self" title="Your twin writes. You decide.">
        <p className="flex items-center gap-2 text-[15px] text-ink">
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-cyan shadow-[0_0_0_4px_rgb(54_209_240/0.2)]" />
          {APPROVAL_NOTICE}
        </p>
      </ScreenHeader>

      {/* Message + draft */}
      <section ref={detailRef} aria-live="polite" className="flex scroll-mt-16 flex-col gap-4">
        {!messages && !inboxError && <MessageSkeleton />}

        {inboxError && (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {inboxError}
            <button type="button" onClick={() => loadInbox()} className={`${QUIET} -my-1 text-red-700 hover:text-red-800`}>
              Try again
            </button>
          </div>
        )}

        {selected && (
          <article key={selected.id} className="glass rise flex flex-col gap-4 p-6">
            <header className="flex flex-col gap-1">
              <span className="label">{selected.relative_time_label} · From</span>
              <span className="text-lg font-medium">{selected.from}</span>
              <span className="text-[15px] text-muted">{selected.subject}</span>
            </header>
            <p className="text-[15px] leading-relaxed">{selected.body}</p>

            {!draft && !drafting && (
              <div className={`grid gap-2 border-t border-line pt-4 ${speech.supported ? 'grid-cols-2' : 'grid-cols-1'}`}>
                <button type="button" onClick={createDraft} disabled={busy} className={`${PILL} ${INK} h-11 px-3 text-[15px]`}>
                  Draft a reply <span aria-hidden="true">→</span>
                </button>
                {speech.supported && (
                  <button
                    type="button"
                    onClick={listen}
                    disabled={busy || speech.listening}
                    className={
                      speech.listening
                        ? `${PILL} h-11 bg-cyan-ink px-3 text-[15px] text-white ${styles.listening}`
                        : `${PILL} ${PAPER} h-11 px-3 text-[15px]`
                    }
                  >
                    <MicIcon />
                    {speech.listening ? 'Say “draft a reply”' : 'Ask by voice'}
                  </button>
                )}
              </div>
            )}
          </article>
        )}

        <div ref={draftRef} className="flex scroll-mb-28 scroll-mt-16 flex-col gap-4">
          {drafting && <DraftSkeleton />}

          {selectedNotice?.kind === 'discarded' && (
            <p role="status" className="glass rise px-6 py-4 text-[15px]">
              Draft discarded. Nothing was sent.
            </p>
          )}

          {selectedNotice?.kind === 'error' && (
            <div role="alert" className="flex flex-col items-start gap-1 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {selectedNotice.message}
              {!draft && (
                <button type="button" onClick={createDraft} disabled={busy} className={`${QUIET} -mb-2 -ml-3 text-red-700 hover:text-red-800`}>
                  Try again
                </button>
              )}
            </div>
          )}

          {draft && selected && (
            <article className="glass rise flex flex-col gap-4 p-6" aria-label="Draft reply">
              <header className="flex flex-col gap-3">
                <span className="label">Reply in Maya&apos;s voice</span>
                <StatusTrack state={draft.state} />
              </header>

              {editing ? (
                <textarea
                  aria-label="Edit the draft"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  rows={6}
                  maxLength={2000}
                  className="w-full rounded-2xl bg-white/80 p-4 text-[16px] leading-relaxed shadow-[inset_0_0_0_1px_var(--color-line)] outline-none focus:shadow-[inset_0_0_0_2px_var(--color-cyan-ink)]"
                />
              ) : (
                <p
                  className={`whitespace-pre-line rounded-2xl bg-white/70 p-4 text-[16px] leading-relaxed shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors duration-500 ${
                    draft.state === 'sent' ? 'text-muted' : ''
                  }`}
                >
                  {draft.body}
                </p>
              )}

              {draft.state === 'sent' ? (
                <>
                  <div role="status" className="rise flex items-start gap-3 rounded-2xl bg-cyan/10 p-4">
                    <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-cyan-ink text-white">
                      <CheckIcon />
                    </span>
                    <p className="flex min-w-0 flex-col gap-1">
                      <span className="text-[15px] font-medium">
                        Sent to {selected.from}
                        {draft.sent_at
                          ? ` at ${new Date(draft.sent_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                          : ''}
                        .
                      </span>
                      <span className="text-sm text-muted">This demo records the send and contacts no one.</span>
                    </p>
                  </div>
                  <div className="rise grid grid-cols-2 gap-3" style={stagger(1)}>
                    {nextUnsent && (
                      <button type="button" onClick={() => select(nextUnsent.id)} className={BIG_SECONDARY}>
                        Next message
                      </button>
                    )}
                    <Link href="/home" className={`${BIG_PRIMARY} ${nextUnsent ? '' : 'col-span-2'}`}>
                      Back to Today
                    </Link>
                  </div>
                </>
              ) : editing ? (
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => transition('edit', editText.trim())}
                    disabled={busy || editText.trim().length === 0}
                    className={PRIMARY}
                  >
                    {working ? 'Saving…' : 'Save edit'}
                  </button>
                  <button type="button" onClick={() => setEditing(false)} disabled={working} className={`${QUIET} hover:text-ink`}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  {draft.state === 'draft' && (
                    <button type="button" onClick={() => transition('approve')} disabled={busy} className={PRIMARY}>
                      {working ? 'Approving…' : 'Approve'}
                    </button>
                  )}
                  {draft.state === 'approved' && (
                    <button type="button" onClick={() => transition('send')} disabled={busy} className={PRIMARY}>
                      {working ? (
                        'Sending…'
                      ) : (
                        <>
                          Send <span aria-hidden="true">→</span>
                        </>
                      )}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditText(draft.body);
                      setEditing(true);
                    }}
                    disabled={busy}
                    className={SECONDARY}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => transition('discard')}
                    disabled={busy}
                    className={`${QUIET} -mr-3 ml-auto text-red-700/80 hover:text-red-700`}
                  >
                    Discard
                  </button>
                </div>
              )}

              <p className="label text-[10px]">{APPROVAL_NOTICE}</p>
            </article>
          )}
        </div>
      </section>

      {/* Inbox */}
      <section aria-labelledby="inbox-heading" className="flex flex-col gap-3">
        <h2 id="inbox-heading" className="label">
          Inbox{messages ? ` · ${messages.length}` : ''}
        </h2>

        <ul className="flex flex-col gap-2">
          {!messages && !inboxError && [0, 1, 2].map((i) => <InboxSkeleton key={i} />)}
          {messages?.map((m, i) => {
            const active = m.id === selectedId;
            const state = drafts[m.id]?.state;
            return (
              <li key={m.id} className="rise" style={stagger(i)}>
                <button
                  type="button"
                  onClick={() => select(m.id)}
                  aria-current={active ? 'true' : undefined}
                  className={`glass tap flex w-full flex-col gap-1 px-5 py-4 text-left ${active ? 'ring-2 ring-cyan-ink/40' : ''}`}
                >
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[15px] font-medium">{m.from}</span>
                    {state ? <StateChip state={state} /> : <span className="label shrink-0 text-[10px]">{m.relative_time_label}</span>}
                  </span>
                  <span className="text-[15px]">{m.subject}</span>
                  <span className="line-clamp-1 text-sm text-muted">{m.body}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}

const STEPS = ['draft', 'approved', 'sent'] as const;
const STEP_LABEL: Record<DraftResponse['state'], string> = {
  draft: 'Draft',
  approved: 'Approved',
  sent: 'Sent',
  discarded: 'Discarded',
};

/** Draft → Approved → Sent, with the highlight sliding to the current step. */
function StatusTrack({ state }: { state: DraftResponse['state'] }) {
  const index = Math.max(0, STEPS.indexOf(state as (typeof STEPS)[number]));
  return (
    <div
      role="status"
      aria-label={`Status: ${STEP_LABEL[state]}`}
      className="relative grid grid-cols-3 rounded-full bg-ink/[0.05] p-1 shadow-[inset_0_0_0_1px_var(--color-line)]"
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full transition-[transform,background-color] duration-500 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none ${
          index === 0 ? 'bg-ink' : 'bg-cyan-ink'
        }`}
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {STEPS.map((step, i) => (
        <span
          key={step}
          aria-hidden="true"
          className={`relative flex h-8 items-center justify-center gap-1 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors duration-300 ${
            i === index ? 'text-white' : i < index ? 'text-cyan-ink' : 'text-muted'
          }`}
        >
          {i < index && <span>✓</span>}
          {STEP_LABEL[step]}
        </span>
      ))}
    </div>
  );
}

function StateChip({ state }: { state: DraftResponse['state'] }) {
  const tone = state === 'draft' ? 'text-muted shadow-[inset_0_0_0_1px_var(--color-line)]' : 'bg-cyan/15 text-cyan-ink';
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] ${tone}`}>
      {STEP_LABEL[state]}
    </span>
  );
}

/** The drafting placeholder: the draft card's shape with a light sweep. */
function DraftSkeleton() {
  return (
    <div className="glass rise flex flex-col gap-4 p-6" aria-label="Drafting a reply">
      <span className="label flex items-center gap-2">
        <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan motion-reduce:animate-none" />
        Drafting in Maya&apos;s voice…
      </span>
      <span aria-hidden="true" className={`h-10 rounded-full ${styles.shimmer}`} />
      <span aria-hidden="true" className="flex flex-col gap-2.5 rounded-2xl bg-white/50 p-4">
        {['w-full', 'w-[94%]', 'w-full', 'w-[58%]'].map((w, i) => (
          <span key={i} className={`h-3.5 rounded-full ${w} ${styles.shimmer}`} />
        ))}
      </span>
      <span aria-hidden="true" className="flex gap-3">
        <span className={`h-11 w-28 rounded-full ${styles.shimmer}`} />
        <span className={`h-11 w-20 rounded-full ${styles.shimmer}`} />
      </span>
    </div>
  );
}

function MessageSkeleton() {
  return (
    <div aria-hidden="true" className="glass flex flex-col gap-4 p-6">
      <span className="flex flex-col gap-2">
        <span className={`h-3 w-24 rounded-full ${styles.shimmer}`} />
        <span className={`h-5 w-3/4 rounded-full ${styles.shimmer}`} />
        <span className={`h-4 w-1/2 rounded-full ${styles.shimmer}`} />
      </span>
      <span className="flex flex-col gap-2">
        {['w-full', 'w-[92%]', 'w-[70%]'].map((w) => (
          <span key={w} className={`h-3.5 rounded-full ${w} ${styles.shimmer}`} />
        ))}
      </span>
      <span className="border-t border-line pt-4">
        <span className={`block h-11 w-40 rounded-full ${styles.shimmer}`} />
      </span>
    </div>
  );
}

function InboxSkeleton() {
  return (
    <li aria-hidden="true" className="glass flex flex-col gap-2 px-5 py-4">
      <span className={`h-4 w-1/2 rounded-full ${styles.shimmer}`} />
      <span className={`h-4 w-2/3 rounded-full ${styles.shimmer}`} />
      <span className={`h-3 w-full rounded-full ${styles.shimmer}`} />
    </li>
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

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}
