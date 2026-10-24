/**
 * `GET /api/assistant/inbox` — the read-only synthetic inbox route. (Req 1, 2)
 *
 * This route surfaces the synthetic Inbox_Message collection for the assistant
 * screen. It reads the inbox at request time via `loadInbox()`, which performs
 * NO database write (Req 1.1, 1.2); on a read/parse failure it responds 503
 * `{ error: 'inbox_unavailable' }`, writing nothing (Req 1.6). On success it
 * decorates each message with a derived `relative_time_label` from
 * `relativeTimeLabel(received_days_ago)` (Req 2) and responds with the fixed
 * "Synthetic data" label plus the messages (Req 1.5).
 *
 * The inbox is read-only synthetic data, not user data, so — unlike the vault
 * routes — this handler requires no authentication and parses no body. It never
 * writes to the database.
 *
 * Requirements: 1.1, 1.2, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4.
 */

import { NextResponse } from 'next/server';

import { loadInbox, relativeTimeLabel } from '@/lib/inbox';
import { InboxResponseSchema } from '@/lib/api-schemas';

export async function GET(): Promise<NextResponse> {
  const result = loadInbox();

  // Read/parse failure: respond 503 and write nothing. (Req 1.6)
  if (!result.ok) {
    return NextResponse.json({ error: 'inbox_unavailable' }, { status: 503 });
  }

  // Decorate each message with its derived relative-time label. (Req 2)
  const messages = result.messages.map((message) => ({
    ...message,
    relative_time_label: relativeTimeLabel(message.received_days_ago),
  }));

  const body = InboxResponseSchema.parse({
    synthetic_label: 'Synthetic data',
    messages,
  });

  return NextResponse.json(body);
}
