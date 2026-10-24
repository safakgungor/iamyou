// Feature: assistant-tasks, Property P2: transition is pure and does not mutate the inbox
//
// Validates: Requirements 4.10, 4.12, 1.2
//
// Property P2 — transition is pure and does not mutate the inbox: for every
// state and event (including invalid inputs), `transition` returns a
// `draft_state` or a `TransitionError` without mutating its arguments, a frozen
// inbox fixture, or any Inbox_Message.

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  transition,
  DRAFT_STATES,
  DRAFT_EVENTS,
  isDraftState,
  isDraftEvent,
  type TransitionError,
} from "@/lib/drafts";

/**
 * A deeply frozen fixture mirroring the shape of the synthetic inbox
 * (`data/synthetic/maya/inbox.json`). `transition` must never touch it; any
 * accidental write against a frozen object throws in strict mode (modules run
 * in strict mode), so the freeze also acts as a tripwire.
 */
const INBOX_FIXTURE = Object.freeze([
  Object.freeze({
    id: "m1",
    from: "Dr. Lee's office, Valley Family Medicine",
    subject: "Your appointment on Thursday",
    received_days_ago: 0,
    synthetic: true,
    body: "Hi Maya, this is a reminder that you have an appointment with Dr. Lee on Thursday at 9:40 am.",
  }),
  Object.freeze({
    id: "m2",
    from: "Jordan (lab partner)",
    subject: "Poster draft?",
    received_days_ago: 1,
    synthetic: true,
    body: "Hey, did you get a chance to look at the poster draft?",
  }),
]);

/** A stable deep snapshot of the fixture, captured once before any transition. */
const INBOX_SNAPSHOT = JSON.stringify(INBOX_FIXTURE);

/** `transition` returns either a valid DraftState or a TransitionError. */
function isTransitionError(value: unknown): value is TransitionError {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    ((value as TransitionError).error === "invalid_state" ||
      (value as TransitionError).error === "invalid_event")
  );
}

/**
 * Arbitrary values that are NOT valid DraftStates/DraftEvents, to exercise the
 * TransitionError path: arbitrary strings, numbers, booleans, null, undefined,
 * objects, and arrays. Filtered to exclude the (rare) case where an arbitrary
 * string happens to be a valid state/event value.
 */
const invalidArb: fc.Arbitrary<unknown> = fc
  .oneof(
    fc.string(),
    fc.integer(),
    fc.double(),
    fc.boolean(),
    fc.constant(null),
    fc.constant(undefined),
    fc.object(),
    fc.array(fc.anything()),
  )
  .filter((v) => !isDraftState(v) && !isDraftEvent(v));

/** Valid states and events drawn from the exported constants. */
const stateArb = fc.constantFrom(...DRAFT_STATES);
const eventArb = fc.constantFrom(...DRAFT_EVENTS);

/** Either a valid state or an invalid value, for the first argument. */
const anyStateArg = fc.oneof(stateArb, invalidArb);
/** Either a valid event or an invalid value, for the second argument. */
const anyEventArg = fc.oneof(eventArb, invalidArb);

describe("transition (Property P2: pure, no mutation — Requirements 4.10, 4.12, 1.2)", () => {
  it("returns a DraftState or a TransitionError, and mutates nothing, for any inputs", () => {
    fc.assert(
      fc.property(anyStateArg, anyEventArg, (state, event) => {
        // Capture pre-call snapshots of the argument values (deep for objects).
        const stateSnapshot = snapshot(state);
        const eventSnapshot = snapshot(event);

        // The frozen inbox fixture must be untouched across the call. We pass
        // the fixture nowhere (transition takes only state + event), so this is
        // a tripwire that transition performs no ambient I/O against it.
        const result = transition(state as never, event as never);

        // Result is always a valid DraftState or a well-formed TransitionError.
        expect(isDraftState(result) || isTransitionError(result)).toBe(true);

        // Arguments are not mutated by the call.
        expect(snapshot(state)).toEqual(stateSnapshot);
        expect(snapshot(event)).toEqual(eventSnapshot);

        // The frozen inbox fixture and its messages are unchanged.
        expect(JSON.stringify(INBOX_FIXTURE)).toEqual(INBOX_SNAPSHOT);
        expect(Object.isFrozen(INBOX_FIXTURE)).toBe(true);
        for (const message of INBOX_FIXTURE) {
          expect(Object.isFrozen(message)).toBe(true);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("returns invalid_state for an invalid state regardless of the event", () => {
    fc.assert(
      fc.property(invalidArb, anyEventArg, (state, event) => {
        const result = transition(state as never, event as never);
        expect(result).toEqual({ error: "invalid_state" });
      }),
      { numRuns: 200 },
    );
  });

  it("returns invalid_event for a valid state with an invalid event", () => {
    fc.assert(
      fc.property(stateArb, invalidArb, (state, event) => {
        const result = transition(state, event as never);
        expect(result).toEqual({ error: "invalid_event" });
      }),
      { numRuns: 200 },
    );
  });

  it("is referentially transparent: identical inputs yield identical outputs", () => {
    fc.assert(
      fc.property(anyStateArg, anyEventArg, (state, event) => {
        const first = transition(state as never, event as never);
        const second = transition(state as never, event as never);
        expect(second).toEqual(first);
      }),
      { numRuns: 200 },
    );
  });
});

/**
 * A structural snapshot for mutation comparison: primitives pass through,
 * objects/arrays are deep-cloned so a later `toEqual` detects any in-place
 * change to the original argument.
 */
function snapshot(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  return structuredClone(value);
}
