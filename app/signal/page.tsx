/**
 * `app/signal/page.tsx` — iamyou Signal, the wrist model, as a public page
 * next to the landing (outside the phone frame).
 *
 * Every number comes from the technical report, `docs/signal-model.md`, and
 * the figures are its own, copied to `public/signal/`. A static server
 * component in the landing's look: it reuses `components/landing/landing.css`
 * and adds only report-page pieces in `signal.css`.
 */

import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';

import '@/components/landing/landing.css';
import './signal.css';

const REPORT = 'https://github.com/safakgungor/iamyou/blob/main/docs/signal-model.md';
const CODE = 'https://github.com/safakgungor/iamyou/tree/main/ml/signal';
const DATASET = 'https://doi.org/10.13026/he0v-tf17';

export const metadata: Metadata = {
  title: 'iamyou Signal · a wrist model that knows your normal',
  description:
    'Judged against each person’s own seated rest, a small wrist model tells rest, stress and exercise apart better than a population model. 33 people, leave-one-subject-out.',
  openGraph: {
    title: 'iamyou Signal',
    description: 'A wrist model that knows your normal: balanced accuracy 0.772 against 0.719, on 33 people.',
    images: ['/signal/fig_d_headline.png'],
  },
};

const RESULTS = [
  {
    metric: 'Balanced accuracy',
    note: 'rest, stress, exercise',
    population: '0.719',
    personal: '0.772',
    delta: '+0.053 [+0.018, +0.087] · p = 0.006',
  },
  {
    metric: 'Macro-F1',
    note: 'rest, stress, exercise',
    population: '0.711',
    personal: '0.764',
    delta: '+0.053 [+0.017, +0.089] · p = 0.008',
  },
  {
    metric: 'Stress-vs-rest AUC',
    note: 'mean per person',
    population: '0.743',
    personal: '0.799',
    delta: '+0.055 [+0.005, +0.106] · p = 0.044 · better for 19 of 33',
  },
  {
    metric: 'Agreement with felt stress',
    note: 'Spearman, within person',
    population: '0.26',
    personal: '0.42',
    delta: '+0.16 [+0.07, +0.25] · p = 0.001',
  },
  {
    metric: 'Exercise recall',
    note: 'windows called exercise',
    population: '0.93',
    personal: '0.94',
    delta: 'Rest 0.79 → 0.84 · stress 0.44 → 0.54',
  },
];

const STEPS = [
  {
    title: '30-second windows',
    text: 'The wristband stream is cut into 30-second windows every 10 seconds.',
  },
  {
    title: '12 features',
    text: 'Heart rate: mean, spread, slope. Skin conductance: mean, spread, slope, summed rise. Skin temperature: mean, slope. Movement: mean, spread, jerk.',
  },
  {
    title: 'Your own normal',
    text: 'Heart-rate, temperature and skin-conductance levels are read as a change from the last 3 minutes of the person’s seated baseline.',
  },
  {
    title: 'Gradient-boosted trees',
    text: 'Depth 4, 300 iterations, balanced classes. The population model sees the same features, raw.',
  },
  {
    title: 'Never tested on itself',
    text: 'Leave-one-subject-out: every person is scored by a model trained only on the other 32.',
  },
];

const FIGURES = [
  {
    src: '/signal/fig_d_headline.png',
    width: 2666,
    height: 1400,
    wide: true,
    title: 'The headline.',
    text: 'Population against personal baseline, with 95% intervals from resampling people. The darker bar re-picks the design inside every fold: the gain stays.',
    alt: 'Bar chart of balanced accuracy, macro-F1 and stress-vs-rest AUC for the population model, the personal-baseline model and the personal-baseline model with nested selection, with confidence intervals.',
  },
  {
    src: '/signal/fig_a_auc_per_subject.png',
    width: 2666,
    height: 1400,
    wide: true,
    title: 'Person by person.',
    text: 'Stress-vs-rest AUC for each of the 33 people. The biggest gains go to people the population model read worst: f17 from 0.31 to 0.66, f04 from 0.53 to 0.89.',
    alt: 'Dot plot of stress-vs-rest AUC per person for the population and personal-baseline models, sorted by the change, better for 19 of 33 people.',
  },
  {
    src: '/signal/fig_b_confusion.png',
    width: 2200,
    height: 1600,
    wide: false,
    title: 'Right and wrong.',
    text: '94% of exercise windows are called exercise. The hard class is stress: 43% of stress-task windows read as rest.',
    alt: 'Confusion matrix of the personal-baseline model over 8,065 windows: rest 84% correct, stress task 54%, exercise 94%.',
  },
  {
    src: '/signal/fig_c_timeline_S07.png',
    width: 2666,
    height: 1500,
    wide: false,
    title: 'One session, out of fold.',
    text: 'Participant S07’s heart rate and the model’s stress probability. It rises in every task and often lingers into the first minute of rest, as the heart does.',
    alt: 'Heart rate of participant S07 during the stress protocol, with the model’s stress probability per 30-second window rising during the Stroop, arithmetic and speech tasks.',
  },
];

export default function SignalPage() {
  return (
    <div className="lx">
      <div className="lx-grain" aria-hidden="true" />

      <header className="lx-header">
        <Link href="/" className="lx-wordmark" aria-label="iamyou home">
          iamyou
        </Link>
        <nav className="lx-nav sg-nav" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#result">Result</a>
          <a href="#figures">Figures</a>
          <a href="#reproduce">Reproduce</a>
        </nav>
        <Link href="/app" className="lx-btn lx-btn--ink lx-btn--sm">
          Launch app <span aria-hidden="true">→</span>
        </Link>
      </header>

      <main className="lx-main sg-main">
        <section className="sg-hero">
          <p className="lx-label lx-index">iamyou Signal · the wrist model</p>
          <h1 className="sg-title">Your wrist, read against your own normal.</h1>
          <p className="lx-lede">
            Does a personal baseline help a wrist model? On 33 people, yes. Judged against their own seated rest, it tells
            rest, stress and exercise apart better than a model that treats everyone the same.
          </p>
          <div className="lx-stats sg-stats">
            <div>
              <span className="lx-stat">0.772</span>
              <span className="lx-label">Balanced accuracy, vs 0.719</span>
            </div>
            <div>
              <span className="lx-stat">94%</span>
              <span className="lx-label">Exercise recognised</span>
            </div>
            <div>
              <span className="lx-stat">0.799</span>
              <span className="lx-label">Stress-vs-rest AUC, vs 0.743</span>
            </div>
          </div>
          <div className="lx-actions">
            <Link href="/real-signal" className="lx-btn lx-btn--ink">
              See it on real data <span aria-hidden="true">→</span>
            </Link>
            <a href={REPORT} className="lx-btn lx-btn--glass" target="_blank" rel="noreferrer">
              Read the report <span aria-hidden="true">↗</span>
            </a>
          </div>
        </section>

        <section className="sg-section" id="question">
          <div className="sg-copy">
            <p className="lx-label lx-index">01 — The question</p>
            <h2 className="lx-h2">The same heart rate means different things.</h2>
          </div>
          <div className="sg-aside">
            <p className="lx-body">
              The same heart rate can be a brisk walk for one person and a racing mind for another. Wearables mostly
              judge everyone against everyone. We asked whether judging each person against their own seated rest helps a small model
              tell three states apart: resting, a mental-stress task, and exercise.
            </p>
            <p className="lx-body">
              Same models, same data, trained twice: once on raw features, once on features read as a change from the
              person&apos;s own baseline.
            </p>
          </div>
        </section>

        <section className="sg-section" id="data">
          <div className="sg-copy">
            <p className="lx-label lx-index">02 — The data</p>
            <h2 className="lx-h2">33 people, 8,065 windows.</h2>
          </div>
          <div className="sg-aside">
            <p className="lx-body">
              Young adults, 18 to 31, wearing a research wristband through a stress protocol (Stroop, mental arithmetic,
              speeches, serial subtraction), a cycling session and a sprint session. Labels come from the protocol&apos;s
              timestamps. After excluding flagged and incomplete sessions, 33 people remain.
            </p>
            <div className="sg-mix" aria-hidden="true">
              <span style={{ width: `${(3573 / 8065) * 100}%` }} />
              <span style={{ width: `${(925 / 8065) * 100}%` }} />
              <span style={{ width: `${(3567 / 8065) * 100}%` }} />
            </div>
            <p className="sg-mix-legend">
              <span className="lx-label">3,573 rest</span>
              <span className="lx-label">925 stress</span>
              <span className="lx-label">3,567 exercise</span>
            </p>
            <p className="lx-body lx-body--quiet">
              Source:{' '}
              <a href={DATASET} className="sg-source" target="_blank" rel="noreferrer">
                PhysioNet, Wearable Device Dataset from Induced Stress and Structured Exercise Sessions v1.0.1
              </a>{' '}
              (ODC-By). Real, de-identified research recordings; nothing from iamyou users.
            </p>
          </div>
        </section>

        <section className="sg-section" id="how">
          <div className="sg-copy">
            <p className="lx-label lx-index">03 — How it works</p>
            <h2 className="lx-h2">Small, personal, and never tested on itself.</h2>
          </div>
          <ol className="sg-aside sg-steps">
            {STEPS.map((step, i) => (
              <li key={step.title}>
                <span className="lx-label lx-index">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{step.title}</strong>
                  <p>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="sg-section" id="result">
          <div className="sg-copy">
            <p className="lx-label lx-index">04 — The result</p>
            <h2 className="lx-h2">The baseline wins, and the win holds.</h2>
            <p className="lx-body">
              Balanced accuracy rises from 0.719 to 0.772, +0.053 with a 95% interval of +0.018 to +0.087 (p = 0.006).
              Intervals come from 10,000 resamples of people; p from a 100,000-flip sign test at the level of people.
            </p>
            <p className="lx-body">
              <strong>Selection doesn&apos;t explain it.</strong> We picked the design after seeing all eight, so we
              re-ran the choice inside every fold, from the training people only. It picked a baseline design in all 33
              folds, never a population one, and still scored 0.770: +0.051 over population (p = 0.009).
            </p>
            <p className="lx-body lx-body--quiet">
              Where it&apos;s weak: stress-task windows often read as rest, and the stress-vs-rest gain is borderline
              after correcting for multiple tests.
            </p>
          </div>
          <div className="sg-aside lx-glass sg-results">
            <div className="sg-row sg-head" aria-hidden="true">
              <span className="lx-label">Metric</span>
              <span className="lx-label">Population → personal</span>
              <span className="lx-label">Difference [95% CI]</span>
            </div>
            <dl>
              {RESULTS.map((r) => (
                <div className="sg-row" key={r.metric}>
                  <dt>
                    {r.metric}
                    <br />
                    <span className="lx-label">{r.note}</span>
                  </dt>
                  <dd className="sg-pair">
                    <span className="sg-was">{r.population}</span> → {r.personal}
                  </dd>
                  <dd className="sg-delta">{r.delta}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="sg-section" id="figures">
          <div className="sg-wide">
            <p className="lx-label lx-index">05 — The figures</p>
            <h2 className="lx-h2">Straight from the report.</h2>
          </div>
          <div className="sg-wide sg-figures">
            {FIGURES.map((f) => (
              <figure key={f.src} className={`lx-glass sg-figure${f.wide ? ' sg-figure--wide' : ''}`}>
                <a href={f.src} target="_blank" rel="noreferrer" aria-label={`${f.title} Open the full-size figure`}>
                  <Image
                    src={f.src}
                    width={f.width}
                    height={f.height}
                    alt={f.alt}
                    sizes={f.wide ? '(max-width: 899px) 100vw, 92vw' : '(max-width: 899px) 100vw, 46vw'}
                  />
                </a>
                <figcaption>
                  <strong>{f.title}</strong> {f.text}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        <section className="sg-section" id="app">
          <div className="sg-copy">
            <p className="lx-label lx-index">06 — In the app</p>
            <h2 className="lx-h2">It explains a rise. It never raises one.</h2>
          </div>
          <div className="sg-aside">
            <p className="lx-body">
              A simple detector notices a sustained heart-rate rise against your baseline. Signal then says what kind of
              rise it looks like: exercise, because you were moving, or stress-like arousal while still. The twin asks
              about the second kind and leaves the first alone.
            </p>
            <p className="lx-body">
              The app ships a lighter cut of the same model: 480 trees in 237 KB, running in the browser and matching
              scikit-learn to within 2.6e-11. It scores 0.777 balanced accuracy out of fold.
            </p>
            <p className="lx-body lx-body--quiet">A wellness estimate, not a medical device.</p>
            <div className="lx-actions">
              <Link href="/real-signal" className="lx-btn lx-btn--ink lx-btn--sm">
                Open the wrist signal <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </section>

        <section className="sg-section" id="reproduce">
          <div className="sg-copy">
            <p className="lx-label lx-index">07 — Reproduce it</p>
            <h2 className="lx-h2">Every number, from the raw data.</h2>
            <p className="lx-body">
              The pipeline in <code>ml/signal/</code> downloads the dataset, builds the windows, trains both models, runs
              the bootstrap, permutation and nested checks, draws the figures and exports the shipped model.
            </p>
            <div className="lx-actions">
              <a href={CODE} className="lx-btn lx-btn--ink lx-btn--sm" target="_blank" rel="noreferrer">
                ml/signal on GitHub <span aria-hidden="true">↗</span>
              </a>
              <a href={REPORT} className="lx-btn lx-btn--glass lx-btn--sm" target="_blank" rel="noreferrer">
                The full report <span aria-hidden="true">↗</span>
              </a>
            </div>
          </div>
          <pre className="sg-aside lx-glass sg-code">
            <span># setup, about 160 MB from PhysioNet</span>
            {'\n'}cd ml/signal
            {'\n'}python3 -m venv .venv
            {'\n'}.venv/bin/pip install -r requirements.txt
            {'\n'}.venv/bin/python scripts/download.py raw
            {'\n\n'}
            <span># windows, then population vs personal (LOSO)</span>
            {'\n'}python -I scripts/build_windows.py raw/Wearable_Dataset windows.csv build.log
            {'\n'}python -I scripts/train.py windows.csv raw out
            {'\n\n'}
            <span># nested selection, bootstrap and permutation</span>
            {'\n'}python -I robustness/nested.py
            {'\n'}python -I robustness/uncertainty.py
          </pre>
        </section>
      </main>

      <footer className="lx-footer sg-footer">
        <p className="lx-footer__mark">I am you.</p>
        <p className="lx-body">A twin that knows your normal, so a change has something to be measured against.</p>
        <div className="lx-actions">
          <Link href="/app" className="lx-btn lx-btn--ink">
            Launch app <span aria-hidden="true">→</span>
          </Link>
          <Link href="/" className="lx-btn lx-btn--glass">
            Back to iamyou
          </Link>
        </div>
        <div className="lx-footer__meta">
          <span className="lx-label">iamyou Signal · October 2026</span>
          <span className="lx-label">Hackachusetts 2026 · Healthcare &amp; Biotech</span>
          <span className="lx-label">Open research data · PhysioNet</span>
        </div>
      </footer>
    </div>
  );
}
