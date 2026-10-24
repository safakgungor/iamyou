import { describe, expect, it } from 'vitest';
import demo from '@/data/public/signal-demo.json';
import { buildWristDemo, type SignalDemo } from '@/lib/wrist-demo';

describe('buildWristDemo', () => {
  const d = buildWristDemo(demo as SignalDemo);

  it('pairs a still stress moment with a moving exercise moment at the same heart rate', () => {
    expect(d.still.read).toBe('stress');
    expect(d.still.phase?.kind).toBe('stress');
    expect(d.moving.read).toBe('exercise');
    expect(d.moving.phase?.kind).toBe('exercise');
    expect(Math.abs(d.still.hr - d.moving.hr)).toBeLessThan(1);
    expect(d.moving.movement).toBeGreaterThan(d.still.movement);
  });

  it('keeps every share within [0, 1] and one window per data point', () => {
    for (const s of [d.stressFound, d.restFalseAlarm, d.exerciseFound]) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
    expect(d.stress.windows).toHaveLength(demo.sessions.stress.t.length);
    expect(d.aerobic.windows).toHaveLength(demo.sessions.aerobic.t.length);
  });

  it('does not mutate the input', () => {
    const before = JSON.stringify(demo);
    buildWristDemo(demo as SignalDemo);
    expect(JSON.stringify(demo)).toBe(before);
  });
});
