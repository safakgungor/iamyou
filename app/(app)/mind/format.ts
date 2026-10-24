import type { MindEntryKind } from '@/lib/mind/types';

/** How each vault entry kind is named on screen. */
export const KIND_LABEL: Record<MindEntryKind, string> = {
  conversation: 'Check-in',
  correction: 'Correction',
  story: 'Story',
  opinion: 'Opinion',
};

/** "2032-06-21T00:00:00+00:00" → "Jun 2032". */
export function formatEntryDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
