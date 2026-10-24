'use client';

/**
 * `app/mind/page.tsx` — the mind tree.
 *
 * A mind map of everything the twin has learned, grown from the vault: the
 * person at the centre, five fixed branches, one leaf per thing learned. It
 * grows outward on load and regrows as the vault grows; leaves the user has
 * not seen before are marked new (seen ids live in `localStorage`). A leaf
 * opens a sheet with the fact and the vault entries it came from.
 *
 * "Ask about yourself" answers from the vault only, by text or voice, and
 * quotes the entries it used (`POST /api/mind/ask`).
 *
 * `GET /api/mind` may answer with a provisional tree (`pending: true`) while
 * Claude regrows it; the page polls until the grown tree arrives.
 */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import gsap from 'gsap';

import { useSpeech } from '@/components/use-speech';
import { MAX_QUESTION_CHARS, type MindAskResponse, type MindResponse } from '@/lib/mind/schemas';
import type { BranchId, MindNode, MindSource } from '@/lib/mind/types';
import { formatEntryDate, KIND_LABEL } from './format';
import MindMap from './mind-map';
import NodeSheet from './node-sheet';
import './mind.css';

const POLL_MS = 3000;
const MAX_POLLS = 20;

const SEEN_KEY = 'iamyou.mind.seen.v1';
const MAX_SEEN = 2000;

const SUGGESTIONS = ['What matters most to me?', 'Who do I call with good news?', 'How do I make big decisions?'];

const DEMO_MESSAGE = 'Start the demo first: open the app and tap Try as Maya.';

/* -------------------------------------------------------------------------- */
/* Seen leaves                                                                */
/* -------------------------------------------------------------------------- */

type Seen = { nodes: string[]; entries: string[] };

/** The leaves seen on earlier visits; null on the first visit. */
function readSeen(): Seen | null {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Seen>;
    return Array.isArray(value.nodes) && Array.isArray(value.entries)
      ? { nodes: value.nodes.map(String), entries: value.entries.map(String) }
      : null;
  } catch {
    return null;
  }
}

function writeSeen(previous: Seen | null, mind: MindResponse): void {
  const nodes = mind.tree.branches.flatMap((b) => b.nodes.map((n) => n.id));
  const entries = mind.entries.map((e) => e.id);
  const merge = (a: string[], b: string[]) => [...new Set([...a, ...b])].slice(-MAX_SEEN);
  try {
    window.localStorage.setItem(
      SEEN_KEY,
      JSON.stringify({ nodes: merge(previous?.nodes ?? [], nodes), entries: merge(previous?.entries ?? [], entries) }),
    );
  } catch {
    // Private mode or blocked storage: leaves just won't be marked new next time.
  }
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function MindPage() {
  const [mind, setMind] = useState<MindResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seen, setSeen] = useState<Seen | null | undefined>(undefined);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Load the tree, then poll while Claude is still regrowing it.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polls = 0;

    async function load() {
      try {
        const res = await fetch('/api/mind', { cache: 'no-store' });
        if (res.status === 401) throw new Error(DEMO_MESSAGE);
        if (!res.ok) throw new Error(`Could not load your mind tree (${res.status}).`);
        const data = (await res.json()) as MindResponse;
        if (cancelled) return;
        setMind(data);
        if (data.pending && polls < MAX_POLLS) {
          polls += 1;
          timer = setTimeout(load, POLL_MS);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load your mind tree.');
      }
    }

    void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // What was seen before this visit is read once; marks stay for the visit.
  useEffect(() => {
    if (mind) setSeen((prev) => (prev === undefined ? readSeen() : prev));
  }, [mind]);

  useEffect(() => {
    if (mind && seen !== undefined) writeSeen(seen, mind);
  }, [mind, seen]);

  // A leaf is new when neither it nor all of its entries were seen before.
  // Nothing is marked on a first visit, when everything would be.
  const newAtLoad = useMemo(() => {
    const ids = new Set<string>();
    if (!mind || !seen) return ids;
    const nodes = new Set(seen.nodes);
    const entries = new Set(seen.entries);
    for (const branch of mind.tree.branches) {
      for (const node of branch.nodes) {
        if (!nodes.has(node.id) && node.entry_ids.some((id) => !entries.has(id))) ids.add(node.id);
      }
    }
    return ids;
  }, [mind, seen]);

  // Opening a new leaf clears its mark.
  const newIds = useMemo(() => new Set([...newAtLoad].filter((id) => !opened.has(id))), [newAtLoad, opened]);

  const sourcesById = useMemo(() => new Map((mind?.entries ?? []).map((e) => [e.id, e])), [mind]);

  const nodeIndex = useMemo(() => {
    const index = new Map<string, { node: MindNode; branchLabel: string }>();
    for (const branch of mind?.tree.branches ?? []) {
      for (const node of branch.nodes) index.set(node.id, { node, branchLabel: branch.label });
    }
    return index;
  }, [mind]);

  const nodeForEntry = useCallback(
    (entryId: string) => {
      for (const [id, { node }] of nodeIndex) if (node.entry_ids.includes(entryId)) return id;
      return null;
    },
    [nodeIndex],
  );

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setOpened((prev) => new Set(prev).add(id));
  }, []);

  const scrollToBranch = useCallback((id: BranchId) => {
    document.getElementById(`branch-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Count up to the number learned; from the old number when the tree regrows.
  const countRef = useRef<HTMLSpanElement>(null);
  const learned = mind?.learned;
  useEffect(() => {
    const el = countRef.current;
    if (!el || learned === undefined) return;
    const from = Number(el.dataset.value ?? '0');
    const done = () => {
      el.textContent = String(learned);
      el.dataset.value = String(learned);
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return done();
    const state = { value: from };
    const tween = gsap.to(state, {
      value: learned,
      duration: from === 0 ? 1.6 : 0.8,
      delay: from === 0 ? 0.35 : 0,
      ease: 'power2.out',
      onUpdate: () => {
        el.textContent = String(Math.round(state.value));
      },
      onComplete: done,
    });
    return () => {
      tween.kill();
    };
  }, [learned]);

  const selected = selectedId ? nodeIndex.get(selectedId) : undefined;

  return (
    <>
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 px-5 pb-12 pt-3">
        <nav className="flex items-center justify-between">
          <Link href="/home" className="label transition-colors hover:text-ink">
            ← Hub
          </Link>
          <span className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted shadow-[inset_0_0_0_1px_var(--color-line)]">
            Synthetic data
          </span>
        </nav>

        <header className="flex flex-col gap-3">
          <p className="label text-cyan-ink">Mind tree</p>
          <h1 className="text-[40px] font-light leading-[0.95] tracking-[-0.04em]">Your mind, mapped.</h1>
          <p className="text-[15px] text-muted">Everything I&apos;ve learned from you, grown from your vault.</p>
        </header>

        {error && (
          <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}{' '}
            {error === DEMO_MESSAGE && (
              <Link href="/app" className="font-medium underline underline-offset-4">
                Open the app
              </Link>
            )}
          </p>
        )}

        {!mind && !error && (
          <section className="flex flex-col items-center gap-3" aria-live="polite">
            <div className="grid aspect-square w-full place-items-center">
              <span className="relative grid h-16 w-16 place-items-center rounded-full bg-ink">
                <span aria-hidden="true" className="absolute h-16 w-16 animate-ping rounded-full bg-cyan/40" />
              </span>
            </div>
            <p className="label">Growing your mind tree…</p>
          </section>
        )}

        {mind && (
          <>
            <section aria-labelledby="learned-heading" className="flex flex-col gap-1">
              <div className="-mx-1">
                <MindMap
                  tree={mind.tree}
                  name={mind.name}
                  growKey={`${mind.version}:${mind.source}`}
                  newIds={newIds}
                  selectedId={selectedId}
                  onSelect={select}
                  onBranch={scrollToBranch}
                />
              </div>

              <h2 id="learned-heading" className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[56px] font-light leading-none tracking-[-0.04em]">
                  <span ref={countRef} data-value="0" aria-hidden="true">
                    0
                  </span>
                  <span className="sr-only">{mind.learned}</span>
                </span>
                <span className="text-[17px]">{mind.learned === 1 ? 'thing learned' : 'things learned'}</span>
                {newIds.size > 0 && (
                  <span className="rounded-full bg-cyan/15 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-cyan-ink">
                    {newIds.size} new
                  </span>
                )}
              </h2>

              <p className="flex items-center gap-2 text-sm text-muted" aria-live="polite">
                {mind.pending ? (
                  <>
                    <span aria-hidden="true" className="h-1.5 w-1.5 animate-ping rounded-full bg-cyan" />
                    Growing the newest leaves…
                  </>
                ) : mind.learned === 0 ? (
                  'Nothing yet. Every check-in plants something.'
                ) : mind.source === 'keywords' ? (
                  'Sorted by keyword for now. Tap a leaf to see where it came from.'
                ) : (
                  'Tap a leaf to see where it came from.'
                )}
              </p>
            </section>

            <AskCard sourcesFor={nodeForEntry} onOpenNode={select} />

            <div className="flex flex-col gap-3">
              {mind.tree.branches.map((branch) => (
                <section
                  key={branch.id}
                  id={`branch-${branch.id}`}
                  aria-labelledby={`branch-${branch.id}-heading`}
                  className="glass flex scroll-mt-16 flex-col gap-3 p-5"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 id={`branch-${branch.id}-heading`} className="label text-ink">
                      {branch.label}
                    </h2>
                    <span className="label text-[10px]">{branch.nodes.length}</span>
                  </div>
                  {branch.nodes.length === 0 ? (
                    <p className="text-sm text-muted">Nothing here yet.</p>
                  ) : (
                    <ul className="flex flex-wrap gap-2">
                      {branch.nodes.map((node, i) => {
                        const fresh = newIds.has(node.id);
                        return (
                          <li key={node.id} className="mind-leaf" style={{ animationDelay: `${0.6 + i * 0.04}s` }}>
                            <button
                              type="button"
                              onClick={() => select(node.id)}
                              className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 text-left text-[14px] leading-tight transition-colors ${
                                fresh
                                  ? 'bg-cyan/15 text-ink shadow-[inset_0_0_0_1.5px_var(--color-cyan-ink)]'
                                  : 'bg-white/75 shadow-[inset_0_0_0_1px_var(--color-line)] hover:bg-white'
                              }`}
                            >
                              {fresh && <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-ink" />}
                              {node.label}
                              {fresh && <span className="sr-only">, new</span>}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              ))}
            </div>

            <Link
              href="/check-in"
              className="glass group flex items-center justify-between gap-4 p-5 transition-transform duration-300 hover:-translate-y-0.5"
            >
              <span className="flex flex-col gap-1">
                <span className="label text-cyan-ink">Grow it</span>
                <span className="text-[17px] font-medium">Teach your twin something new</span>
                <span className="text-sm text-muted">Every check-in and correction adds a leaf.</span>
              </span>
              <span
                aria-hidden="true"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink text-white transition-colors group-hover:bg-cyan-ink"
              >
                →
              </span>
            </Link>
          </>
        )}
      </main>

      {selected && (
        <NodeSheet
          key={selected.node.id}
          node={selected.node}
          branchLabel={selected.branchLabel}
          sources={selected.node.entry_ids.map((id) => sourcesById.get(id)).filter((s): s is MindSource => !!s)}
          isNew={newAtLoad.has(selected.node.id)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Ask about yourself                                                         */
/* -------------------------------------------------------------------------- */

const FIXED_LABEL: Record<'support' | 'counselor' | 'health', string> = {
  support: 'Support',
  counselor: 'Genetic counselor',
  health: 'Your doctor',
};

function AskCard({
  sourcesFor,
  onOpenNode,
}: {
  sourcesFor: (entryId: string) => string | null;
  onOpenNode: (nodeId: string) => void;
}) {
  const speech = useSpeech();
  const [question, setQuestion] = useState('');
  const [asked, setAsked] = useState('');
  const [answer, setAnswer] = useState<MindAskResponse | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const voice = useRef<'idle' | 'armed' | 'listening'>('idle');
  const busy = useRef(false);

  const ask = useCallback(
    async (text: string, spoken = false) => {
      const q = text.trim().slice(0, MAX_QUESTION_CHARS);
      if (!q || busy.current) return;
      busy.current = true;
      setAsking(true);
      setAskError(null);
      setAsked(q);
      try {
        const res = await fetch('/api/mind/ask', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q }),
        });
        if (res.status === 401) throw new Error(DEMO_MESSAGE);
        if (!res.ok) throw new Error(`Could not ask right now (${res.status}).`);
        const data = (await res.json()) as MindAskResponse;
        setAnswer(data);
        setQuestion('');
        if (spoken) speech.speak(data.answer);
      } catch (err) {
        setAskError(err instanceof Error ? err.message : 'Could not ask right now.');
      } finally {
        busy.current = false;
        setAsking(false);
      }
    },
    [speech],
  );

  // Voice: the transcript fills the box, and the question is asked when the
  // mic stops. Armed only by the mic button, so stray speech does nothing.
  useEffect(() => {
    if (voice.current !== 'idle' && speech.transcript) setQuestion(speech.transcript);
  }, [speech.transcript]);

  useEffect(() => {
    if (speech.listening) {
      if (voice.current === 'armed') voice.current = 'listening';
      return;
    }
    if (voice.current === 'listening') {
      voice.current = 'idle';
      if (speech.transcript) void ask(speech.transcript, true);
    }
  }, [speech.listening, speech.transcript, ask]);

  const listen = () => {
    voice.current = 'armed';
    speech.reset();
    speech.listen();
  };

  return (
    <section aria-labelledby="ask-heading" className="glass flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h2 id="ask-heading" className="label text-cyan-ink">
          Ask about yourself
        </h2>
        <p className="text-sm text-muted">I answer only from your vault, and show you where.</p>
      </div>

      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(question);
        }}
      >
        <input
          type="text"
          aria-label="Your question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={MAX_QUESTION_CHARS}
          placeholder={speech.listening ? 'Listening…' : 'Ask me about you…'}
          disabled={asking}
          className="h-12 min-w-0 flex-1 rounded-full bg-white/80 px-4 text-[16px] shadow-[inset_0_0_0_1px_var(--color-line)] outline-none placeholder:text-muted/70 focus:shadow-[inset_0_0_0_2px_var(--color-cyan-ink)] disabled:opacity-60"
        />
        {speech.supported && (
          <button
            type="button"
            onClick={listen}
            disabled={asking || speech.listening}
            aria-label={speech.listening ? 'Listening' : 'Ask by voice'}
            className={`grid h-12 w-12 shrink-0 place-items-center rounded-full shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors disabled:opacity-60 ${
              speech.listening ? 'bg-cyan/20 text-cyan-ink' : 'bg-white/80 hover:bg-white'
            }`}
          >
            <MicIcon />
          </button>
        )}
        <button
          type="submit"
          disabled={asking || question.trim().length === 0}
          aria-label="Ask"
          className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-ink text-white transition-colors hover:bg-cyan-ink disabled:opacity-40"
        >
          <span aria-hidden="true">→</span>
        </button>
      </form>

      {!answer && !asking && (
        <ul className="flex flex-wrap gap-2" aria-label="Try asking">
          {SUGGESTIONS.map((s) => (
            <li key={s}>
              <button
                type="button"
                onClick={() => void ask(s)}
                className="rounded-full px-3 py-1.5 text-[13px] text-muted shadow-[inset_0_0_0_1px_var(--color-line)] transition-colors hover:bg-white/70 hover:text-ink"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div aria-live="polite" className="flex flex-col gap-3">
        {asking && (
          <p className="flex items-center gap-3 text-[15px]">
            <span aria-hidden="true" className="h-2.5 w-2.5 animate-ping rounded-full bg-cyan" />
            Looking through your vault…
          </p>
        )}

        {askError && (
          <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {askError}
          </p>
        )}

        {answer && !asking && (
          <>
            <p className="label text-[10px]">You asked · {asked}</p>
            {answer.kind === 'support' || answer.kind === 'counselor' || answer.kind === 'health' ? (
              <div role="alert" className="flex flex-col gap-1 rounded-2xl border-l-4 border-l-cyan-ink bg-white/80 p-4">
                <span className="label text-cyan-ink">{FIXED_LABEL[answer.kind]}</span>
                <p className="text-[16px] leading-relaxed">{answer.answer}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-1 rounded-[22px_22px_22px_6px] bg-white/80 p-4 shadow-[inset_0_0_0_1px_var(--color-line)]">
                <span className="label text-cyan-ink">Twin</span>
                <p className={`text-[16px] leading-relaxed ${answer.kind === 'empty' ? 'text-muted' : ''}`}>{answer.answer}</p>
              </div>
            )}

            {answer.sources.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="label">From your vault · {answer.sources.length}</span>
                <ul className="flex flex-col gap-2">
                  {answer.sources.map((s) => {
                    const nodeId = sourcesFor(s.id);
                    const body = (
                      <>
                        <span className="flex items-baseline justify-between gap-3">
                          <span className="label text-[10px] text-ink">{KIND_LABEL[s.kind]}</span>
                          <span className="label text-[10px]">{formatEntryDate(s.created_at)}</span>
                        </span>
                        <span className="block text-[14px] leading-relaxed">“{s.text}”</span>
                      </>
                    );
                    return (
                      <li key={s.id}>
                        {nodeId ? (
                          <button
                            type="button"
                            onClick={() => onOpenNode(nodeId)}
                            className="flex w-full flex-col gap-1.5 rounded-2xl border-l-2 border-l-cyan bg-white/60 p-3 text-left transition-colors hover:bg-white"
                          >
                            {body}
                          </button>
                        ) : (
                          <div className="flex flex-col gap-1.5 rounded-2xl border-l-2 border-l-cyan bg-white/60 p-3">{body}</div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function MicIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
