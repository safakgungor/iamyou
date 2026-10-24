import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateMayaWeeklyFeatures,
  serializeWeeklyFeatures,
} from '../../scripts/generate-maya';

// Determinism of Maya's synthetic history: the generator is re-run in memory and compared
// byte-for-byte with the committed file, and its source is scanned for anything that
// depends on time, locale, environment or inexactly specified math (design D10).
// Requirements: 6.1, 6.2

const root = process.cwd();
const mayaDir = join(root, 'data/synthetic/maya');
const scriptPath = join(root, 'scripts/generate-maya.ts');

const profile = JSON.parse(readFileSync(join(mayaDir, 'profile.json'), 'utf8')) as {
  start_date: string;
  simulated_through: string;
};

// Remove block and line comments so header prose such as "no Math.random" is not scanned.
// The script has no string or regex literal containing `//` or `/*`, which the
// sanity assertions below confirm by checking that real code survives the strip.
const code = readFileSync(scriptPath, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

describe('scripts/generate-maya.ts determinism', () => {
  it('produces identical output on two calls, byte-equal to the committed file', () => {
    const first = serializeWeeklyFeatures(generateMayaWeeklyFeatures(profile));
    const second = serializeWeeklyFeatures(generateMayaWeeklyFeatures(profile));
    const committed = readFileSync(join(mayaDir, 'weekly-features.json'));

    expect(second).toBe(first);
    expect(first).toBe(committed.toString('utf8'));
    expect(Buffer.from(first, 'utf8').equals(committed)).toBe(true);
  });

  it('source code uses no time, locale, environment, random or inexact math', () => {
    // Sanity: the comment strip kept the code itself.
    expect(code).toContain('Math.imul');
    expect(code).toContain('export function generateMayaWeeklyFeatures');
    expect(code).not.toMatch(/no Math\.random/);

    const forbidden: [string, RegExp][] = [
      ['Date.now', /Date\s*\.\s*now/],
      ['argument-less new Date()', /new\s+Date\s*\(\s*\)/],
      ['Math.random', /Math\s*\.\s*random/],
      ['toLocale*', /toLocale/],
      ['process.env', /process\s*\.\s*env/],
      ['Math.pow', /Math\s*\.\s*pow/],
      ['Math.exp', /Math\s*\.\s*exp/],
      ['**', /\*\*/],
    ];
    for (const [name, pattern] of forbidden) {
      expect(code, `found ${name}`).not.toMatch(pattern);
    }
  });

  describe('importing the module', () => {
    afterEach(() => {
      vi.doUnmock('node:fs');
      vi.resetModules();
    });

    it('writes no file', async () => {
      const writeFileSync = vi.fn();
      const appendFileSync = vi.fn();
      vi.resetModules();
      vi.doMock('node:fs', async (importOriginal) => {
        const actual = await importOriginal<typeof import('node:fs')>();
        return { ...actual, default: actual, writeFileSync, appendFileSync };
      });

      const mod = await import('../../scripts/generate-maya');

      expect(typeof mod.generateMayaWeeklyFeatures).toBe('function');
      expect(writeFileSync).not.toHaveBeenCalled();
      expect(appendFileSync).not.toHaveBeenCalled();
    });
  });
});
