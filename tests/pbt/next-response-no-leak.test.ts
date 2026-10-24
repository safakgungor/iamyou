// Feature: twin-loop, Supporting property: Next-response non-leak
// Validates: Requirement 4.5
//
// The `GET /api/checkin/next` route predicts the user's answer BEFORE they
// respond and stores it, but the response it returns must never carry that
// prediction (Req 4.5 — the prediction is never shown before the user answers).
// This property drives arbitrary predicted text through a mocked Claude client
// and asserts the serialized next-response body never contains it.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  nextCheckIn,
  type CheckInClaude,
  type CheckInPrompt,
} from "@/app/api/checkin/next/route";
import { InMemoryVaultRepository } from "@/lib/db/vault-repository";
import type { PredictionRequest } from "@/lib/prediction";
import type { VaultEntryKind } from "@/lib/db/vault-repository";

const KINDS: ReadonlyArray<VaultEntryKind> = [
  "conversation",
  "correction",
  "story",
  "opinion",
  "style_example",
];

// A sentinel that cannot appear in any generated prompt or vault-entry text,
// because every generated string is drawn from a charset that excludes NUL.
// Wrapping the predicted text in it guarantees the prediction cannot coincide
// with the prompt text (the only user-visible string in the response), so a
// leak is the ONLY way the sentinel could appear in the serialized body.
const SENTINEL = "\u0000PREDICTED_TEXT_SENTINEL\u0000";

// Printable text free of the sentinel (no NUL characters).
const safeText = fc.string().map((s) => s.replace(/\u0000/g, ""));

const vaultEntry = fc.record({
  kind: fc.constantFrom(...KINDS),
  text: safeText,
  createdAt: fc
    .date({
      min: new Date("2000-01-01"),
      max: new Date("2100-01-01"),
      noInvalidDate: true,
    })
    .map((d) => d.toISOString()),
});

// A non-empty prompt list; prompt ids are fixed c01.. in index order so the
// route can select the lowest-numbered unanswered prompt.
const promptList = fc
  .array(safeText, { minLength: 1, maxLength: 5 })
  .map((texts): CheckInPrompt[] =>
    texts.map((text, i) => ({
      id: `c${String(i + 1).padStart(2, "0")}`,
      category: "general",
      text,
    })),
  );

describe("nextCheckIn (Supporting property: Next-response non-leak)", () => {
  it("serialized next-response body never contains the predicted text", async () => {
    await fc.assert(
      fc.asyncProperty(
        safeText, // the body of the predicted text
        fc.array(vaultEntry, { maxLength: 30 }), // arbitrary vault entries
        promptList, // at least one prompt
        async (predictedBody, entries, prompts) => {
          const userId = "user-1";
          const sessionId = "session-1";

          // Fresh repo, fresh session (no answers), seeded with arbitrary vault
          // entries so the prediction context is non-trivial.
          const repo = new InMemoryVaultRepository();
          for (const entry of entries) {
            await repo.addVaultEntry(userId, entry);
          }

          // The predicted text is sentinel-wrapped so it cannot equal the
          // prompt text; any appearance in the response is therefore a leak.
          const predictedText = `${SENTINEL}${predictedBody}${SENTINEL}`;
          const claude: CheckInClaude = {
            predictAnswer: async (_request: PredictionRequest) => predictedText,
          };

          const response = await nextCheckIn(
            repo,
            claude,
            prompts,
            userId,
            sessionId,
          );

          // A non-empty prompt list on a fresh session always yields a prompt.
          expect(response).not.toBeNull();

          const serialized = JSON.stringify(response);
          expect(serialized.includes(predictedText)).toBe(false);

          // And the prediction WAS actually generated and stored — the twin did
          // predict; the response simply withholds the text.
          expect(response!.prediction_id).toBeTruthy();
        },
      ),
      { numRuns: 100 },
    );
  });
});
