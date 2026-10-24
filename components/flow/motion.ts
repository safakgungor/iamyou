'use client';

/**
 * Small motion helpers for the demo flows. Entrances use the shared `.rise`
 * utility (stagger with `stagger(i)`); the count-up and typing effects run on
 * requestAnimationFrame and jump straight to the end under reduced motion.
 */

import { useEffect, useState, type CSSProperties } from 'react';

/** Inline style for `.rise` staggering: `<div className="rise" style={stagger(2)}>`. */
export const stagger = (i: number) => ({ '--i': i }) as CSSProperties;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** Counts from 0 up to `target` once `active` turns true. */
export function useCountUp(target: number, active: boolean, duration = 900, delay = 0): number {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!active) {
      setValue(0);
      return;
    }
    if (prefersReducedMotion()) {
      setValue(target);
      return;
    }
    let frame = 0;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now + delay;
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      setValue(Math.round(easeOut(t) * target));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, active, duration, delay]);

  return value;
}

/**
 * Reveals `text` a few characters per frame once `active` turns true, so it
 * reads as if it is being typed. The whole text takes about `duration` ms
 * however long it is.
 */
export function useTyped(text: string, active: boolean, duration = 1400, delay = 0): string {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!active) {
      setCount(0);
      return;
    }
    if (prefersReducedMotion()) {
      setCount(text.length);
      return;
    }
    let frame = 0;
    let start: number | null = null;
    const step = (now: number) => {
      start ??= now + delay;
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      setCount(Math.round(t * text.length));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [text, active, duration, delay]);

  return text.slice(0, count);
}
