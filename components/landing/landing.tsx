'use client';

/**
 * iamyou landing page. One idea runs through it: the twin forms. A particle
 * cloud assembles into Maya at 18 behind the loader, becomes the twin's sphere
 * chapter by chapter as the visitor scrolls, and ends as Maya at 40.
 * A HUD readout counts the twin's age and patterns alongside it.
 *
 * Copy lives in the DOM; the canvas is decoration (aria-hidden). Reduced
 * motion gets native scroll, instant orb changes and no pins.
 */

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { useGSAP } from '@gsap/react';
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import './landing.css';
import RealSignalChart from './real-signal';
import type { RealSignal } from './real-signal-data';
import type { TwinForm, TwinStage } from './twin-stage';

gsap.registerPlugin(ScrollTrigger, SplitText, useGSAP);

const BASE: TwinForm = { scatter: 0, figure: 0, figure2: 0, dissolve: 0, pulse: 0, x: 0, y: 0, scale: 1, opacity: 1 };
const form = (f: Partial<TwinForm>): TwinForm => ({ ...BASE, ...f });

/** Every screen in the app, so the landing reaches all of it. Screens that need
 *  Maya's demo session go through /app, which signs in and then opens `next`. */
const APP_MAP = [
  { href: '/app?next=/check-in', kicker: 'Daily check-in', title: 'The twin answers first', text: 'One question, by voice or text.' },
  { href: '/app?next=/assistant', kicker: 'Second self', title: 'Replies in her voice', text: 'Nothing is sent without approval.' },
  { href: '/app?next=/mind', kicker: 'Mind tree', title: 'Everything it knows', text: 'A map of her, with sources.' },
  { href: '/app?next=/timeline', kicker: 'Health layer', title: '22 years, one baseline', text: 'Speech and sleep, week by week.' },
  { href: '/real-signal', kicker: 'Wrist signal', title: 'Same heart, two reasons', text: 'Real PhysioNet wristband data.' },
  { href: '/app?next=/care', kicker: 'Care', title: 'Ready for the visit', text: 'Summary, studies, family mode.' },
  { href: '/app?next=/onboarding', kicker: 'Consent', title: 'Her right not to know', text: 'Who hears about a change.' },
  { href: '/signal', kicker: 'Our model', title: 'iamyou Signal', text: 'Trained on 33 people. 0.77 balanced accuracy.' },
];

/** Orb form per chapter: [desktop, mobile]. */
const ORB = {
  hero: [form({ figure: 1, x: 1.6, y: -0.02, scale: 1.2 }), form({ figure: 1, y: 0.8, scale: 0.78, opacity: 0.9 })],
  gap: [form({ scatter: 0.9, x: 0.7, scale: 1.15, opacity: 0.5 }), form({ scatter: 0.9, y: 0.3, scale: 0.85, opacity: 0.32 })],
  loop: [form({ x: -0.08, y: -0.15, scale: 0.44 }), form({ y: 1.05, scale: 0.5, opacity: 0.35 })],
  assist: [form({ x: 0, y: 0.62, scale: 0.4 }), form({ y: 1.05, scale: 0.5, opacity: 0.35 })],
  baseline: [form({ pulse: 1, x: 1.95, y: 0.95, scale: 0.5 }), form({ pulse: 1, y: 1.1, scale: 0.45, opacity: 0.35 })],
  film: [form({ x: 0, scale: 1.6, opacity: 0.1 }), form({ scale: 1.2, opacity: 0.1 })],
  beyond: [form({ figure2: 1, dissolve: 1, x: 1.55, y: -0.15, scale: 1.08 }), form({ figure2: 1, dissolve: 1, y: 0.45, scale: 0.8, opacity: 0.45 })],
  end: [form({ scatter: 0.22, y: 0.3, scale: 0.8, opacity: 0.55 }), form({ scatter: 0.22, y: 0.6, scale: 0.6, opacity: 0.4 })],
} satisfies Record<string, [TwinForm, TwinForm]>;
type OrbKey = keyof typeof ORB;

/** HUD readout per chapter, mirroring the film's twin card. */
const HUD: Record<OrbKey, { stage: string; key: string; value: number } | null> = {
  hero: { stage: 'Age 18 · Day 1', key: 'Patterns', value: 19 },
  gap: { stage: 'Age 18–40 · no twin', key: 'Days unseen', value: 8008 },
  loop: { stage: 'Day 10', key: 'Patterns', value: 214 },
  assist: { stage: 'Age 22', key: 'Patterns', value: 3180 },
  baseline: { stage: 'Age 30 · baseline week', key: 'Week', value: 645 },
  film: null,
  beyond: { stage: 'Age 40', key: 'Patterns', value: 14902 },
  end: null,
};

const VISITS = 22;

export default function Landing({ signal }: { signal: RealSignal }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<TwinStage | null>(null);
  const lenisRef = useRef<Lenis | null>(null);
  const formRef = useRef<TwinForm>(form({ scatter: 1, opacity: 0 }));
  const readyRef = useRef<{ promise: Promise<void>; resolve: () => void } | null>(null);
  const [playing, setPlaying] = useState(false);

  if (!readyRef.current) {
    let resolve = () => {};
    const promise = new Promise<void>((r) => (resolve = r));
    readyRef.current = { promise, resolve };
  }

  // The WebGL stage: loaded after first paint, driven by the GSAP ticker.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let stage: TwinStage | null = null;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const light = window.matchMedia('(pointer: coarse)').matches || window.innerWidth < 900;

    (async () => {
      try {
        const load = (name: string) => fetch(`/landing/${name}.bin`).then((r) => r.arrayBuffer());
        const [{ TwinStage }, young, older] = await Promise.all([import('./twin-stage'), load('maya18'), load('maya40')]);
        if (cancelled) return;
        stage = new TwinStage(canvas, { young: new Int16Array(young), older: new Int16Array(older) }, {
          count: light ? 14000 : 22000,
          dpr: Math.min(window.devicePixelRatio, light ? 1.5 : 1.75),
          frozen: reduce,
        });
        stageRef.current = stage;
      } catch {
        rootRef.current?.setAttribute('data-gl', 'off');
      } finally {
        readyRef.current?.resolve();
      }
    })();

    const tick = (time: number) => stageRef.current?.render(time, formRef.current);
    const onResize = () => stageRef.current?.resize();
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      stageRef.current?.setPointer((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    };
    gsap.ticker.add(tick);
    window.addEventListener('resize', onResize);
    window.addEventListener('pointermove', onMove);
    return () => {
      cancelled = true;
      gsap.ticker.remove(tick);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onMove);
      stageRef.current = null;
      stage?.dispose();
    };
  }, []);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return;
      const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel);
      const qa = <T extends Element = HTMLElement>(sel: string) => Array.from(root.querySelectorAll<T>(sel));
      const hudStage = q('[data-hud-stage]');
      const hudKey = q('[data-hud-key]');
      const hudValue = q('[data-hud-value]');
      const hud = q('[data-hud]');
      const header = q('[data-header]');
      const hudCount = { v: 0 };
      let hudKeyNow: OrbKey = 'hero';
      let hudBlocked = 0;
      const showHud = () =>
        gsap.to(hud, { autoAlpha: HUD[hudKeyNow] && hudBlocked === 0 ? 1 : 0, duration: 0.4, overwrite: 'auto' });

      const setHud = (key: OrbKey, instant: boolean) => {
        const h = HUD[key];
        hudKeyNow = key;
        showHud();
        if (!h || !hudStage || !hudKey || !hudValue) return;
        hudStage.textContent = h.stage;
        hudKey.textContent = h.key;
        gsap.to(hudCount, {
          v: h.value,
          duration: instant ? 0 : 1.4,
          ease: 'power2.out',
          overwrite: true,
          onUpdate: () => {
            hudValue.textContent = Math.round(hudCount.v).toLocaleString('en-US');
          },
        });
      };

      const goTo = (key: OrbKey, instant: boolean, duration = 1.6) => {
        const target = ORB[key][window.matchMedia('(max-width: 899px)').matches ? 1 : 0];
        if (instant) gsap.set(formRef.current, target);
        else gsap.to(formRef.current, { ...target, duration, ease: 'power3.inOut', overwrite: true });
        setHud(key, instant);
      };

      const mm = gsap.matchMedia();
      mm.add(
        {
          motion: '(prefers-reduced-motion: no-preference)',
          desktop: '(min-width: 900px)',
        },
        (ctx) => {
          const { motion, desktop } = ctx.conditions as { motion: boolean; desktop: boolean };
          let live = true;
          let lenis: Lenis | null = null;
          const raf = (t: number) => lenis?.raf(t * 1000);

          if (motion) {
            lenis = new Lenis({ lerp: 0.1, autoRaf: false });
            lenisRef.current = lenis;
            lenis.on('scroll', ScrollTrigger.update);
            lenis.on('scroll', (l: Lenis) => {
              stageRef.current?.setVelocity(l.velocity);
              header?.classList.toggle('is-hidden', l.direction === 1 && l.scroll > 160);
            });
            gsap.ticker.add(raf);
            gsap.ticker.lagSmoothing(0);
          }

          const loaded = root.dataset.loading === 'false';
          const startScroll = () => {
            lenis?.start();
            document.documentElement.classList.remove('lx-locked');
          };
          if (!loaded) {
            lenis?.stop();
            document.documentElement.classList.add('lx-locked');
          }

          // Text reveals: lines rise out of masks; everything else fades up.
          const lineReveals = (els: HTMLElement[], immediate: boolean) =>
            els.map((el) =>
              SplitText.create(el, {
                type: 'lines',
                mask: 'lines',
                autoSplit: true,
                onSplit: (self) =>
                  gsap.from(self.lines, {
                    yPercent: motion ? 115 : 0,
                    autoAlpha: motion ? 1 : 0,
                    duration: motion ? 1.1 : 0.4,
                    ease: 'power4.out',
                    stagger: 0.07,
                    delay: immediate ? 0.15 : 0,
                    scrollTrigger: immediate ? undefined : { trigger: el, start: 'top 86%', once: true },
                  }),
              }),
            );

          const revealPage = () => {
            lineReveals(qa('[data-hero] [data-reveal="lines"]'), true);
            gsap.from(qa('[data-hero] [data-reveal="fade"]'), {
              y: motion ? 24 : 0,
              autoAlpha: 0,
              duration: 0.9,
              ease: 'power4.out',
              stagger: 0.08,
              delay: 0.55,
            });
            gsap.from([header, hud], { y: motion ? -12 : 0, autoAlpha: 0, duration: 0.6, ease: 'power3.out', delay: 0.9 });

            lineReveals(qa('[data-chapter] [data-reveal="lines"]'), false);
            qa('[data-chapter] [data-reveal="fade"]').forEach((el) =>
              gsap.from(el, {
                y: motion ? 28 : 0,
                autoAlpha: 0,
                duration: motion ? 0.9 : 0.4,
                ease: 'power4.out',
                scrollTrigger: { trigger: el, start: 'top 88%', once: true },
              }),
            );

            qa('[data-count]').forEach((el) => {
              const to = Number(el.dataset.count);
              const c = { v: 0 };
              gsap.to(c, {
                v: to,
                duration: motion ? 1.6 : 0,
                ease: 'power2.out',
                scrollTrigger: { trigger: el, start: 'top 85%', once: true },
                onUpdate: () => {
                  el.textContent = Math.round(c.v).toLocaleString('en-US') + (el.dataset.suffix ?? '');
                },
              });
            });

            const days = q('[data-days]');
            if (days) {
              gsap.from(q('[data-days-fill]'), {
                scaleX: 0,
                transformOrigin: 'left center',
                ease: 'none',
                scrollTrigger: { trigger: days, start: 'top 85%', end: 'top 40%', scrub: motion ? 1 : false },
              });
              gsap.from(qa('[data-visit]'), {
                scale: 0,
                autoAlpha: 0,
                duration: 0.5,
                ease: 'back.out(1.6)',
                stagger: 0.035,
                scrollTrigger: { trigger: days, start: 'top 70%', once: true },
              });
            }

            const loop = q('[data-loop]');
            const steps = qa('[data-step]');
            const marks = qa('[data-step-mark]');
            const mark = (i: number) => marks.forEach((m, k) => m.classList.toggle('is-active', k === i));
            if (loop && motion && desktop) {
              gsap.set(steps.slice(1), { autoAlpha: 0.12, y: 18 });
              mark(0);
              const tl = gsap.timeline({
                scrollTrigger: {
                  trigger: loop,
                  start: 'top top',
                  end: '+=160%',
                  pin: true,
                  scrub: 1,
                  onUpdate: (self) => mark(self.progress < 0.36 ? 0 : self.progress < 0.7 ? 1 : 2),
                },
              });
              tl.to(steps[1], { autoAlpha: 1, y: 0, duration: 1 }, 0.4).to(steps[2], { autoAlpha: 1, y: 0, duration: 1 }, 1.6).to({}, { duration: 0.6 });
            } else {
              marks.forEach((m) => m.classList.add('is-active'));
            }

            // Wide content (the chart, the film) gets the HUD's corner to itself.
            qa('[data-hud-hide]').forEach((el) =>
              ScrollTrigger.create({
                trigger: el,
                start: 'top 80%',
                end: 'bottom 20%',
                onToggle: (self) => {
                  hudBlocked += self.isActive ? 1 : -1;
                  showHud();
                },
              }),
            );

            qa('[data-orb]').forEach((sec) =>
              ScrollTrigger.create({
                trigger: sec,
                start: 'top 55%',
                end: 'bottom 45%',
                onToggle: (self) => {
                  if (self.isActive) goTo(sec.dataset.orb as OrbKey, !motion);
                },
              }),
            );

            ScrollTrigger.refresh();
          };

          if (loaded) {
            revealPage();
          } else {
            const counter = q('[data-loader-count]');
            const loader = q('[data-loader]');
            const p = { v: 0 };
            const fmt = () => {
              if (counter) counter.textContent = String(Math.round(p.v)).padStart(3, '0');
            };
            let seen = false;
            try {
              seen = sessionStorage.getItem('lx-seen') === '1';
              sessionStorage.setItem('lx-seen', '1');
            } catch {}
            const minTime = !motion ? 0.2 : seen ? 0.6 : 1.7;
            gsap.to(p, { v: 74, duration: minTime, ease: 'power2.out', onUpdate: fmt });
            gsap.to(formRef.current, { scatter: 0.6, opacity: 1, duration: minTime + 0.3, ease: 'power2.out' });

            Promise.all([
              document.fonts.ready,
              readyRef.current?.promise,
              new Promise((r) => setTimeout(r, minTime * 1000)),
            ]).then(() => {
              if (!live) return;
              gsap.to(p, {
                v: 100,
                duration: motion ? 0.5 : 0,
                ease: 'power2.inOut',
                onUpdate: fmt,
                onComplete: () => {
                  if (!live) return;
                  gsap.to(loader, { autoAlpha: 0, duration: motion ? 0.7 : 0, ease: 'power2.in' });
                  root.dataset.loading = 'false';
                  goTo('hero', !motion, 2.4);
                  startScroll();
                  revealPage();
                },
              });
            });
          }

          return () => {
            live = false;
            gsap.ticker.remove(raf);
            lenis?.destroy();
            lenisRef.current = null;
            document.documentElement.classList.remove('lx-locked');
          };
        },
      );
    },
    { scope: rootRef },
  );

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (lenisRef.current) lenisRef.current.scrollTo(el, { duration: 1.6 });
    else el.scrollIntoView({ behavior: 'auto' });
  };

  const playFilm = () => {
    const v = videoRef.current;
    if (!v) return;
    setPlaying(true);
    void v.play();
  };

  return (
    <div ref={rootRef} className="lx" data-loading="true">
      <canvas ref={canvasRef} className="lx-gl" aria-hidden="true" />
      <div className="lx-halo" aria-hidden="true" />
      <div className="lx-grain" aria-hidden="true" />

      <div className="lx-loader" data-loader aria-hidden="true">
        <span className="lx-label">Assembling a twin</span>
        <span className="lx-loader__count" data-loader-count>
          000
        </span>
      </div>

      <header className="lx-header" data-header>
        <Link href="/" className="lx-wordmark" aria-label="iamyou home">
          iamyou
        </Link>
        <nav className="lx-nav" aria-label="Sections">
          <button type="button" onClick={() => scrollTo('loop')}>
            The loop
          </button>
          <button type="button" onClick={() => scrollTo('baseline')}>
            Baseline
          </button>
          <Link href="/signal">Model</Link>
          <button type="button" onClick={() => scrollTo('film')}>
            Film
          </button>
        </nav>
        <Link href="/app" className="lx-btn lx-btn--ink lx-btn--sm">
          Launch app <span aria-hidden="true">→</span>
        </Link>
      </header>

      <aside className="lx-hud lx-glass" data-hud aria-hidden="true">
        <span className="lx-label lx-hud__twin">
          <i className="lx-hud__dot" /> Maya&apos;s twin
        </span>
        <span className="lx-hud__stage" data-hud-stage>
          Age 18 · Day 1
        </span>
        <span className="lx-hud__row">
          <span className="lx-label" data-hud-key>
            Patterns
          </span>
          <span className="lx-hud__value" data-hud-value>
            0
          </span>
        </span>
        <span className="lx-label lx-hud__note">Synthetic persona</span>
      </aside>

      <main className="lx-main">
        {/* 00 · Hero */}
        <section className="lx-hero" data-hero data-orb="hero">
          <p className="lx-label" data-reveal="fade">
            A digital twin, from age 18
          </p>
          <h1 className="lx-display" data-reveal="lines">
            I am you.
          </h1>
          <p className="lx-lede" data-reveal="fade">
            A twin that grows with you, thinks like you and works for you.
          </p>
          <div className="lx-actions" data-reveal="fade">
            <Link href="/app" className="lx-btn lx-btn--ink">
              Launch app <span aria-hidden="true">→</span>
            </Link>
            <button type="button" className="lx-btn lx-btn--glass" onClick={() => scrollTo('film')}>
              Watch the film
            </button>
          </div>
          <span className="lx-scroll lx-label" data-reveal="fade">
            Scroll
          </span>
        </section>

        {/* 01 · The gap */}
        <section className="lx-chapter lx-chapter--left" data-chapter data-orb="gap" id="gap">
          <p className="lx-label lx-index" data-reveal="fade">
            01 — The gap
          </p>
          <h2 className="lx-h2" data-reveal="lines">
            Once a year. At a clinic.
          </h2>
          <p className="lx-body" data-reveal="fade">
            Families with Huntington&apos;s, familial Alzheimer&apos;s or ALS are studied in visits. One check-up a year,
            and the years in between go unrecorded.
          </p>
          <div className="lx-stats" data-reveal="fade">
            <div>
              <span className="lx-stat" data-count={VISITS}>
                {VISITS}
              </span>
              <span className="lx-label">Visits, age 18 to 40</span>
            </div>
            <div>
              <span className="lx-stat" data-count="8000" data-suffix="+">
                8,000+
              </span>
              <span className="lx-label">Days unseen</span>
            </div>
          </div>
          <div className="lx-days" data-days aria-hidden="true">
            <span className="lx-days__fill" data-days-fill />
            {Array.from({ length: VISITS }, (_, i) => (
              <span key={i} className="lx-days__visit" data-visit style={{ left: `${(i / (VISITS - 1)) * 100}%` }} />
            ))}
          </div>
        </section>

        {/* 02 · The loop */}
        <section className="lx-chapter lx-chapter--right lx-loop" data-chapter data-orb="loop" data-loop id="loop">
          <div className="lx-loop__copy">
            <p className="lx-label lx-index" data-reveal="fade">
              02 — The loop
            </p>
            <h2 className="lx-h2" data-reveal="lines">
              It predicts. You correct. It learns.
            </h2>
            <p className="lx-body" data-reveal="fade">
              One short question a day. The twin answers first, as you. Then you answer. The gap between the two is how it
              learns you.
            </p>
            <ol className="lx-steps" data-reveal="fade">
              <li data-step-mark>
                <span className="lx-label">01</span> Predict
              </li>
              <li data-step-mark>
                <span className="lx-label">02</span> Correct
              </li>
              <li data-step-mark>
                <span className="lx-label">03</span> Learn
              </li>
            </ol>
          </div>

          <article className="lx-card lx-glass" data-reveal="fade" aria-label="Example check-in with Maya, a synthetic persona">
            <header className="lx-card__head">
              <span className="lx-label">Check-in · Day 10</span>
              <span className="lx-tag">Synthetic persona</span>
            </header>
            <p className="lx-card__prompt">What&apos;s the first thing you&apos;d do with a free Saturday?</p>
            <div className="lx-card__row" data-step>
              <span className="lx-label">Twin predicted</span>
              <p>A long run along the river first thing in the morning, then pancakes.</p>
            </div>
            <div className="lx-card__row" data-step>
              <span className="lx-label">Maya answered</span>
              <p>Sleep in a little, then a long run by the river and pancakes after.</p>
            </div>
            <div className="lx-card__row lx-card__score" data-step>
              <span className="lx-label">Match</span>
              <span className="lx-meter">
                <span style={{ width: '75%' }} />
              </span>
              <strong>0.75</strong>
              <p className="lx-card__reply">&ldquo;I had the river run and pancakes, but I missed that you sleep in first.&rdquo;</p>
            </div>
          </article>
        </section>

        {/* 03 · The second self */}
        <section className="lx-chapter lx-chapter--left lx-assist" data-chapter data-orb="assist" id="assist">
          <div>
            <p className="lx-label lx-index" data-reveal="fade">
              03 — The second self
            </p>
            <h2 className="lx-h2" data-reveal="lines">
              It works for you.
            </h2>
            <p className="lx-body" data-reveal="fade">
              It drafts replies in your voice: the doctor&apos;s office, the landlord, your sister. Nothing leaves without your
              yes.
            </p>
          </div>

          <article className="lx-card lx-glass" data-reveal="fade" aria-label="Example draft reply, synthetic">
            <header className="lx-card__head">
              <span className="lx-label">Inbox · Today</span>
              <span className="lx-tag">Synthetic data</span>
            </header>
            <p className="lx-card__from">Dr. Lee&apos;s office, Valley Family Medicine</p>
            <p className="lx-card__quote">
              A reminder that you have an appointment with Dr. Lee on Thursday at 9:40 am. Please reply to confirm.
            </p>
            <div className="lx-card__draft">
              <span className="lx-label">Draft in Maya&apos;s voice</span>
              <p>Hi! Thursday at 9:40 works for me. See you then. Maya</p>
            </div>
            <div className="lx-card__buttons">
              <span className="lx-btn lx-btn--ink lx-btn--sm" aria-hidden="true">
                Approve
              </span>
              <span className="lx-btn lx-btn--glass lx-btn--sm" aria-hidden="true">
                Edit
              </span>
              <span className="lx-label">Waiting for your yes</span>
            </div>
          </article>
        </section>

        {/* 04 · The baseline */}
        <section className="lx-chapter lx-baseline" data-chapter data-orb="baseline" id="baseline">
          <div className="lx-baseline__copy">
            <p className="lx-label lx-index" data-reveal="fade">
              04 — The baseline
            </p>
            <h2 className="lx-h2" data-reveal="lines">
              A baseline, while you&apos;re well.
            </h2>
            <p className="lx-body" data-reveal="fade">
              With consent, it learns how you speak, sleep and recover across healthy years, so a slow change has something
              to be measured against. It reads your wristband too, and asks what a wearable can&apos;t see.
            </p>
            <p className="lx-body lx-body--quiet" data-reveal="fade">
              You decide who hears about a change: you, only your doctor, or no one.
            </p>
            <div className="lx-actions" data-reveal="fade">
              <Link href="/real-signal" className="lx-btn lx-btn--glass lx-btn--sm">
                Open the wrist signal <span aria-hidden="true">→</span>
              </Link>
              <Link href="/app?next=/timeline" className="lx-btn lx-btn--glass lx-btn--sm">
                See Maya&apos;s 22 years <span aria-hidden="true">→</span>
              </Link>
              <Link href="/signal" className="lx-btn lx-btn--glass lx-btn--sm">
                How the model works <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
          <div data-reveal="fade" data-hud-hide>
            <RealSignalChart signal={signal} />
          </div>
        </section>

        {/* 05 · The film */}
        <section className="lx-chapter lx-film" data-chapter data-orb="film" id="film">
          <p className="lx-label lx-index" data-reveal="fade">
            05 — The film
          </p>
          <h2 className="lx-h2" data-reveal="lines">
            Twenty years, in under three minutes.
          </h2>
          <div className="lx-film__frame lx-glass" data-reveal="fade">
            <video
              ref={videoRef}
              src="/landing/iamyou-film.mp4"
              poster="/landing/film-poster.jpg"
              preload="none"
              playsInline
              controls={playing}
              onPause={() => setPlaying(false)}
              onPlay={() => setPlaying(true)}
            />
            {!playing && (
              <button type="button" className="lx-film__play" onClick={playFilm} aria-label="Play the film">
                <span className="lx-film__icon" aria-hidden="true" />
                <span className="lx-label">Play the film · 2:55</span>
              </button>
            )}
          </div>
        </section>

        {/* 06 · Beyond */}
        <section className="lx-chapter lx-chapter--left lx-beyond" data-chapter data-orb="beyond" id="beyond">
          <p className="lx-label lx-index" data-reveal="fade">
            06 — Beyond
          </p>
          <h2 className="lx-h2" data-reveal="lines">
            If illness takes her words, a mind that thinks like her is still there.
          </h2>
          <p className="lx-statement" data-reveal="lines">
            Potentially, a part of her, living outside her body.
          </p>
          <dl className="lx-roadmap" data-reveal="fade">
            <div>
              <dt className="lx-label">Today</dt>
              <dd>A twin that grows with you</dd>
            </div>
            <div>
              <dt className="lx-label">Next</dt>
              <dd>Research partners</dd>
            </div>
          </dl>
        </section>
      </main>

      <footer className="lx-footer" data-chapter data-orb="end">
        <p className="lx-footer__mark" data-reveal="lines">
          I am you.
        </p>
        <p className="lx-body" data-reveal="fade">
          Head in the stars. Feet in this week&apos;s MVP.
        </p>
        <div className="lx-actions" data-reveal="fade">
          <Link href="/app" className="lx-btn lx-btn--ink">
            Launch app <span aria-hidden="true">→</span>
          </Link>
          <button type="button" className="lx-btn lx-btn--glass" onClick={() => scrollTo('film')}>
            Watch the film
          </button>
        </div>
        <nav className="lx-appmap" aria-label="Inside the app" data-reveal="fade">
          <p className="lx-label lx-index">Inside the app</p>
          <div className="lx-appmap__grid">
            {APP_MAP.map((item) => (
              <Link key={item.href} href={item.href} className="lx-glass lx-appmap__tile">
                <span className="lx-label">{item.kicker}</span>
                <span className="lx-appmap__title">{item.title}</span>
                <span className="lx-appmap__text">{item.text}</span>
              </Link>
            ))}
          </div>
        </nav>
        <div className="lx-footer__meta">
          <span className="lx-label">Built with Kiro and Claude</span>
          <span className="lx-label">Hackachusetts 2026 · Healthcare &amp; Biotech</span>
          <span className="lx-label">Maya is a synthetic persona. iamyou does not diagnose.</span>
        </div>
      </footer>

      <noscript>
        <style>{'.lx-main,.lx-header,.lx-footer{visibility:visible!important;opacity:1!important}.lx-loader{display:none!important}'}</style>
      </noscript>
    </div>
  );
}
