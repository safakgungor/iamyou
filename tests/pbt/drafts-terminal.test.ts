// Feature: assistant-tasks, Property P3: Terminal states are terminal
//
// Validates: Requirements 4.8, 4.9
//
// Property P3 — Terminal states are terminal: for the states `sent` and
// `discarded` and every `draft_event`, `transition` returns the same state it
// was given. Both terminal states absorb every event.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { transition, TERMINAL_STATES, DRAFT_EVENTS } from "@/lib/drafts";

const draftEventArb = fc.constantFrom(...DRAFT_EVENTS);

describe("Property P3: Terminal states are terminal (Requirements 4.8, 4.9)", () => {
  it("returns the same terminal state for every event", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...TERMINAL_STATES),
        draftEventArb,
        (terminalState, event) => {
          expect(transition(terminalState, event)).toBe(terminalState);
        },
      ),
      { numRuns: 100 },
    );
  });
});
