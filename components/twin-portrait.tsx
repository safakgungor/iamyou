'use client';

/**
 * Maya as particles, sized to its box: the same twin stage as the landing
 * page, in a card. On mount the scattered particles gather into Maya at 18
 * (`shape="maya"`) or into the twin's sphere (`shape="twin"`); while `waking`
 * is true the sphere pulses. Decorative only.
 */

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import type { TwinForm, TwinStage } from './landing/twin-stage';

const BASE: TwinForm = { scatter: 0, figure: 0, figure2: 0, dissolve: 0, pulse: 0, x: 0, y: 0, scale: 1, opacity: 1 };
const PORTRAIT: TwinForm = { ...BASE, figure: 1, y: -0.12, scale: 1.55 };
const SPHERE: TwinForm = { ...BASE, scale: 1.35 };
const PULSE: TwinForm = { ...SPHERE, pulse: 0.6 };

export default function TwinPortrait({
  shape = 'maya',
  waking = false,
  count = 12000,
  pointSize = 15,
  className = '',
}: {
  shape?: 'maya' | 'twin';
  waking?: boolean;
  count?: number;
  pointSize?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<TwinStage | null>(null);
  const rest = shape === 'maya' ? PORTRAIT : SPHERE;
  const formRef = useRef<TwinForm>({ ...rest, figure: 0, scatter: 1, opacity: 0 });
  const restRef = useRef(rest);
  restRef.current = rest;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let stage: TwinStage | null = null;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    (async () => {
      try {
        const load = (name: string) => fetch(`/landing/${name}.bin`).then((r) => r.arrayBuffer());
        const [{ TwinStage }, young, older] = await Promise.all([import('./landing/twin-stage'), load('maya18'), load('maya40')]);
        if (cancelled) return;
        stage = new TwinStage(canvas, { young: new Int16Array(young), older: new Int16Array(older) }, {
          count,
          dpr: Math.min(window.devicePixelRatio, 2),
          frozen: reduce,
          pointSize,
        });
        stageRef.current = stage;
        gsap.to(formRef.current, { ...restRef.current, duration: reduce ? 0 : 2.4, ease: 'expo.out' });
      } catch {
        // No WebGL: the card simply stays empty.
      }
    })();

    const tick = (time: number) => stageRef.current?.render(time, formRef.current);
    const resize = new ResizeObserver(() => stageRef.current?.resize());
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      stageRef.current?.setPointer(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    gsap.ticker.add(tick);
    resize.observe(canvas);
    canvas.addEventListener('pointermove', onMove);
    return () => {
      cancelled = true;
      gsap.ticker.remove(tick);
      resize.disconnect();
      canvas.removeEventListener('pointermove', onMove);
      stageRef.current = null;
      stage?.dispose();
    };
    // The stage is built once per mount; `count` and `pointSize` only matter then.
  }, []);

  useEffect(() => {
    if (!stageRef.current && !waking) return;
    gsap.to(formRef.current, { ...(waking ? PULSE : restRef.current), duration: 1.6, ease: 'power3.inOut', overwrite: true });
  }, [waking]);

  return <canvas ref={canvasRef} aria-hidden="true" className={`block h-full w-full ${className}`} />;
}
