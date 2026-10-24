/**
 * Read-only synthetic inbox and relative-time rendering for assistant-tasks.
 *
 * `loadInbox` reads and parses the Inbox_Message collection from
 * `data/synthetic/maya/inbox.json` at request time and returns every message,
 * performing NO database write (Req 1.1, 1.2); on a read or parse failure it
 * returns `{ ok: false, error: 'inbox_unavailable' }` and writes nothing
 * (Req 1.6). `relativeTimeLabel` is a pure total string function over
 * `received_days_ago` (Req 2). Neither function ever throws.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A single read-only synthetic inbox message. (Req 1.3) */
export type InboxMessage = {
  id: string;
  from: string;
  subject: string;
  body: string;
  received_days_ago: number;
  synthetic: true;
};

/** The outcome of loading the inbox: the messages, or an unavailable signal. (Req 1.6) */
export type InboxResult =
  | { ok: true; messages: InboxMessage[] }
  | { ok: false; error: 'inbox_unavailable' };

/** The highest `received_days_ago` value that renders a label (10 years). (Req 2.3) */
const MAX_DAYS_AGO = 3650;

/**
 * The default location of the synthetic inbox, resolved against the process
 * working directory (the repository root under both `next` and Vitest). The
 * read happens at request time so the file is re-read on every call. (Req 1.1)
 */
const DEFAULT_INBOX_PATH = join(
  process.cwd(),
  'data',
  'synthetic',
  'maya',
  'inbox.json',
);

/** Narrows an unknown value to a well-formed `InboxMessage`. */
function isInboxMessage(value: unknown): value is InboxMessage {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.from === 'string' &&
    typeof record.subject === 'string' &&
    typeof record.body === 'string' &&
    typeof record.received_days_ago === 'number' &&
    record.synthetic === true
  );
}

/**
 * Reads and parses the Inbox_Message collection from
 * `data/synthetic/maya/inbox.json` (or `filePath`, when given) at request time
 * and returns every message. Performs NO database write (Req 1.1, 1.2). On a
 * read failure, a parse failure, or a payload that is not a valid
 * Inbox_Message collection, returns `{ ok: false, error: 'inbox_unavailable' }`
 * and writes nothing, never throwing. (Req 1.6)
 */
export function loadInbox(filePath: string = DEFAULT_INBOX_PATH): InboxResult {
  try {
    // The path is a parameter, so the bundler cannot scope it; skip tracing
    // here and ship the one file through outputFileTracingIncludes instead.
    const raw = readFileSync(/*turbopackIgnore: true*/ filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed) || !parsed.every(isInboxMessage)) {
      return { ok: false, error: 'inbox_unavailable' };
    }

    return { ok: true, messages: parsed };
  } catch {
    return { ok: false, error: 'inbox_unavailable' };
  }
}

/**
 * Pure rendering of the relative-time label from `received_days_ago`:
 *
 *   0                              -> "Today"            (Req 2.1)
 *   1                              -> "1 day ago"        (Req 2.2)
 *   integer N in [2, 3650]         -> "N days ago"       (Req 2.3)
 *   absent | null | non-integer |  -> ""                 (Req 2.4)
 *     negative | > 3650
 *
 * Any value outside the integer range [0, 3650] — including `null`,
 * `undefined`, non-integers, and negatives — maps to the empty string, and the
 * function never throws. (Req 2.4)
 */
export function relativeTimeLabel(receivedDaysAgo: unknown): string {
  if (
    typeof receivedDaysAgo !== 'number' ||
    !Number.isInteger(receivedDaysAgo) ||
    receivedDaysAgo < 0 ||
    receivedDaysAgo > MAX_DAYS_AGO
  ) {
    return '';
  }

  if (receivedDaysAgo === 0) {
    return 'Today';
  }

  if (receivedDaysAgo === 1) {
    return '1 day ago';
  }

  return `${receivedDaysAgo} days ago`;
}
