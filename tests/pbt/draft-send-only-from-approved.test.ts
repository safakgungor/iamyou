// Feature: assistant-tasks, Property P1: Send only from approved
//
// Validates: Requirements 4.3, 4.7, 4.11
//
// Property P1 — Send only from approved: for any sequence of `DraftEvent` values
// applied through `transition` starting from `draft`, the `sent` state is reached
// only on a `send` event applied to the `approved` state; no other path reaches
// `sent`. This is the structural guarantee that nothing is sent without approval.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  transition,
  DRAFT_EVENTS,
  type DraftState,
  type DraftEvent,
} from "@/lib/drafts";

// A generator over the four valid events.
const draftEventArb: fc.Arbitrary<DraftEvent> = fc.constantFrom(...DRAFT_EVENTS);

// A sequence of events applied one after another, starting from `draft`.
const eventSequenceArb: fc.Arbitrary<DraftEvent[]> = fc.array(draftEventArb, {
  maxLength: 12,
});

describe("Property P1: Send only from approved (Requirements 4.3, 4.7, 4.11)", () => {
  it("reaches `sent` only on `send` applied to `approved`, never via any other path", () => {
    fc.assert(
      fc.property(eventSequenceArb, (events) => {
        let state: DraftState = "draft";

        for (const event of events) {
          const prev = state;
          const next = transition(prev, event);

          // `transition` over valid states/events always returns a DraftState.
          expect(typeof next).toBe("string");
          const nextState = next as DraftState;

          // The ONLY way to arrive at `sent` is the exact pair approved + send.
          if (nextState === "sent" && prev !== "sent") {
            expect(prev).toBe("approved");
            expect(event).toBe("send");
          }

          // Conversely: approved + send is the only transition that produces
          // `sent`; every other (prev, event) pair must NOT land on `sent`.
          if (prev === "approved" && event === "send") {
            expect(nextState).toBe("sent");
          } else if (prev !== "sent") {
            expect(nextState).not.toBe("sent");
          }

          state = nextState;
        }
      }),
      { numRuns: 100 },
    );
  });

  it("no sequence starting from `draft` can reach `sent` without passing through `approved` then `send`", () => {
    fc.assert(
      fc.property(eventSequenceArb, (events) => {
        let state: DraftState = "draft";
        let everApproved = false;
        let reachedSent = false;

        for (const event of events) {
          if (state === "approved") {
            everApproved = true;
          }
          state = transition(state, event) as DraftState;
          if (state === "sent") {
            reachedSent = true;
          }
        }

        // If the run ever reached `sent`, it must have been in `approved` at
        // some earlier step (the only predecessor of `sent`).
        if (reachedSent) {
          expect(everApproved).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
