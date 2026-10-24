import { describe, expect, it } from 'vitest';
import { FEATURES } from '@/lib/baseline';
import {
  CountyResponseSchema,
  FeatureNameSchema,
  TimelineResponseSchema,
  type TimelineOptedIn,
} from '@/lib/claude/schemas';

const row = {
  week_start: '2026-10-24',
  vocabulary_diversity: 0.72,
  mean_sentence_length: 14.1,
  filler_rate: 2.48,
  sleep_hours: null,
  active_minutes: 284,
  twin_accuracy: 0.78,
  synthetic: true,
};
const { synthetic: _synthetic, ...zRow } = row;
const nullBaseline = Object.fromEntries(FEATURES.map((f) => [f, null]));

const optedIn: TimelineOptedIn = {
  opted_in: true,
  rtk_setting: 'tell_me',
  rows: [row],
  z_scores: [{ ...zRow, sleep_hours: null }],
  baseline: { ...nullBaseline, sleep_hours: { mean: 7.2, sd: 0.4 } } as TimelineOptedIn['baseline'],
  signal: {
    features: ['sleep_hours', 'active_minutes'],
    first_week: '2026-10-03',
    detected_week: '2026-10-17',
  },
};

describe('FeatureNameSchema', () => {
  it('mirrors FEATURES in lib/baseline.ts', () => {
    expect(FeatureNameSchema.options).toEqual([...FEATURES]);
  });
});

describe('TimelineResponseSchema (Req 7.6, 9.1, 9.3, 9.4)', () => {
  it('accepts exactly { opted_in: false }', () => {
    expect(TimelineResponseSchema.safeParse({ opted_in: false }).success).toBe(true);
  });

  it('rejects an opted-out body carrying any other key', () => {
    for (const extra of [{ rows: [] }, { signal: null }, { rtk_setting: 'tell_me' }]) {
      expect(TimelineResponseSchema.safeParse({ opted_in: false, ...extra }).success).toBe(false);
    }
  });

  it('accepts a full opted-in body and keeps opted_in first', () => {
    const parsed = TimelineResponseSchema.parse(optedIn);
    expect(Object.keys(parsed)[0]).toBe('opted_in');
    expect(TimelineResponseSchema.safeParse({ ...optedIn, signal: null, rtk_setting: null }).success).toBe(true);
  });

  it('requires signal to be present on the opted-in body', () => {
    const { signal: _signal, ...withoutSignal } = optedIn;
    expect(TimelineResponseSchema.safeParse(withoutSignal).success).toBe(false);
  });

  it('rejects a signal with fewer than two features, extra keys and non-finite numbers', () => {
    const oneFeature = { ...optedIn, signal: { ...optedIn.signal!, features: ['sleep_hours'] } };
    expect(TimelineResponseSchema.safeParse(oneFeature).success).toBe(false);
    expect(TimelineResponseSchema.safeParse({ ...optedIn, extra: 1 }).success).toBe(false);
    const nanRow = { ...optedIn, rows: [{ ...row, filler_rate: Number.NaN }] };
    expect(TimelineResponseSchema.safeParse(nanRow).success).toBe(false);
  });
});

describe('CountyResponseSchema (Req 8.2, 8.3, 8.5)', () => {
  const card = { county: 'Hampshire', year: 2022, prevalence: 31.5, low: 26.8, high: 36.4 };

  it('accepts the card and the unavailable result', () => {
    expect(CountyResponseSchema.safeParse({ available: true, card }).success).toBe(true);
    expect(CountyResponseSchema.safeParse({ available: false }).success).toBe(true);
  });

  it('rejects population, misordered values and numbers on the unavailable result', () => {
    const bad = [
      { available: true, card: { ...card, population: 160000 } },
      { available: true, card: { ...card, low: 32 } },
      { available: true, card: { ...card, high: 101 } },
      { available: false, prevalence: 31.5 },
    ];
    for (const body of bad) expect(CountyResponseSchema.safeParse(body).success).toBe(false);
  });
});
