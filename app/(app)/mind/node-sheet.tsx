'use client';

/**
 * The bottom sheet for one leaf: what the twin learned, and the vault entries
 * it came from, with their kind, date and words.
 *
 * Inside the desktop phone frame the screen is its own transformed scroll
 * container, where `position: fixed` would scroll with the content, so the
 * sheet pins itself to the visible part of that screen and locks its scroll.
 * On a phone it is a plain fixed overlay.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';

import type { MindNode, MindSource } from '@/lib/mind/types';
import { formatEntryDate, KIND_LABEL } from './format';

const CLOSE_MS = 240;

export default function NodeSheet({
  node,
  branchLabel,
  sources,
  isNew,
  onClose,
}: {
  node: MindNode;
  branchLabel: string;
  sources: MindSource[];
  isNew: boolean;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState<CSSProperties>({ position: 'fixed', inset: 0 });
  const [shown, setShown] = useState(false);

  // Pin to the phone screen's visible area and lock its scroll while open.
  useLayoutEffect(() => {
    const screen = rootRef.current?.closest<HTMLElement>('.device-screen');
    const framed = screen && getComputedStyle(screen).overflowY === 'auto';
    const scroller = framed ? screen : document.documentElement;
    const previous = scroller.style.overflow;
    if (framed) {
      setBox({ position: 'absolute', left: 0, right: 0, top: screen.scrollTop, height: screen.clientHeight });
    }
    scroller.style.overflow = 'hidden';
    return () => {
      scroller.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => setShown(true));
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      cancelAnimationFrame(frame);
      opener?.focus?.({ preventScroll: true });
    };
  }, []);

  // Slide out first, then let the page unmount the sheet.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const close = useCallback(() => {
    setShown(false);
    setTimeout(() => onCloseRef.current(), CLOSE_MS);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  return (
    <div ref={rootRef} style={box} className="z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={close}
        className={`mind-sheet-backdrop absolute inset-0 bg-ink/25 backdrop-blur-[2px] ${shown ? 'opacity-100' : 'opacity-0'}`}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mind-sheet-title"
        className={`mind-sheet-panel relative flex max-h-[82%] flex-col gap-4 overflow-y-auto rounded-t-[28px] bg-canvas px-5 pb-10 pt-3 shadow-[0_-24px_60px_-30px_rgb(24_33_46/0.45)] ${
          shown ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <span aria-hidden="true" className="mx-auto h-1 w-10 shrink-0 rounded-full bg-ink/15" />

        <header className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <p className="label text-cyan-ink">
              {branchLabel}
              {isNew ? ' · New' : ''}
            </p>
            <h2 id="mind-sheet-title" className="text-[28px] font-light leading-[1.05] tracking-[-0.03em]">
              {node.label}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            className="tap grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/80 text-muted shadow-[inset_0_0_0_1px_var(--color-line)] transition hover:text-ink"
          >
            <span aria-hidden="true">✕</span>
            <span className="sr-only">Close</span>
          </button>
        </header>

        <p className="text-[17px] leading-relaxed">{node.fact}</p>

        <section aria-labelledby="mind-sheet-sources" className="flex flex-col gap-2">
          <h3 id="mind-sheet-sources" className="label">
            From your vault · {sources.length}
          </h3>
          <ul className="flex flex-col gap-2">
            {sources.map((s, i) => (
              <li key={s.id} className="rise flex flex-col gap-2 rounded-2xl bg-white/80 p-4 shadow-[inset_0_0_0_1px_var(--color-line)]" style={{ '--i': i + 2 } as CSSProperties}>
                <span className="flex items-baseline justify-between gap-3">
                  <span className="label text-[10px] text-ink">{KIND_LABEL[s.kind]}</span>
                  <span className="label text-[10px]">{formatEntryDate(s.created_at)}</span>
                </span>
                <p className="text-[15px] leading-relaxed">“{s.text}”</p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
