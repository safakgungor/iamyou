// Feature: assistant-tasks, Task 1.5: unit tests for `validateDraftSafety`.
//
// These tests exercise the pure draft-safety screen in `lib/drafts.ts`. The
// validator rejects Claude-generated draft text that introduces health content
// absent from the source message, states or implies a condition / diagnosis /
// risk, or gives health guidance stronger than the single allowed sentence
// "You might want to talk to your doctor about this."
//
// Covered behaviours (design "Requirement 7 safety check", Req 7.1–7.3):
//   - a clean confirmation reply passes;
//   - a draft that ADDS a diagnosis word absent from the source is rejected;
//   - a draft that ADDS a health claim absent from the source is rejected;
//   - guidance stronger than the one allowed sentence is rejected;
//   - the exact allowed sentence passes;
//   - the HEALTH_TERMS / SCHEDULING_WORDS constants are exported as specified;
//   - REQUIRED: a plain confirmation reply passes for EVERY message in
//     `data/synthetic/maya/inbox.json` (ids m1–m5).
//
// Validates: Requirements 7.1, 7.2, 7.3
import { describe, expect, it } from "vitest";

import inbox from "@/data/synthetic/maya/inbox.json";
import {
  HEALTH_TERMS,
  SCHEDULING_WORDS,
  validateDraftSafety,
} from "@/lib/drafts";

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

/** The m1 doctor's-office appointment reminder is the hardest safe case. */
const DOCTOR_SOURCE = inbox.find((m) => m.id === "m1")!.body;

const ALLOWED_SENTENCE = "You might want to talk to your doctor about this.";

/* -------------------------------------------------------------------------- */
/* Tests                                                                      */
/* -------------------------------------------------------------------------- */

describe("validateDraftSafety", () => {
  it("passes a clean confirmation reply to the doctor's office (Req 7.1, 7.2)", () => {
    const draft = "Thursday at 9:40 works for me. See you then. Maya";

    expect(validateDraftSafety(draft, DOCTOR_SOURCE)).toEqual({ ok: true });
  });

  it("rejects a draft that introduces a diagnosis absent from the source (Req 7.1)", () => {
    const draft =
      "Thanks for the reminder. I think this is about my recent diagnosis. See you Thursday. Maya";

    const result = validateDraftSafety(draft, DOCTOR_SOURCE);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/diagnos/i);
    }
  });

  it("rejects a draft that introduces a health claim absent from the source (Req 7.2)", () => {
    const source = "Hey, can you make it to the run on Saturday?";
    const draft =
      "I will be there. My doctor said my genetic test result came back positive. Maya";

    const result = validateDraftSafety(draft, source);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // "genetic" and "test result" are both added health content.
      expect(result.reason).toMatch(/health content/i);
    }
  });

  it("rejects health guidance stronger than the one allowed sentence (Req 7.3)", () => {
    const source = "Hope you are feeling well.";
    const draft =
      "Thanks for checking in. You should see a specialist right away. Maya";

    const result = validateDraftSafety(draft, source);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/guidance/i);
    }
  });

  it("matches health terms as whole words, not inside other words (Req 7.1, 7.2)", () => {
    const source = "Are you free the Sunday after next?";
    const draft = "I'm free! I'll also bring the general plan and the totals. Maya";

    expect(validateDraftSafety(draft, source).ok).toBe(true);
    expect(validateDraftSafety("Is it ALS?", source).ok).toBe(false);
  });

  it("allows everyday advice that is not about health (Req 7.3)", () => {
    const source = "Bring water; the fountain at mile 5 is off.";
    const draft = "Thanks! You should come too, and make sure to bring snacks. Maya";

    expect(validateDraftSafety(draft, source).ok).toBe(true);
  });

  it("passes the exact allowed guidance sentence (Req 7.3)", () => {
    const source = "Hope you are feeling well.";
    const draft = `Thanks for checking in. ${ALLOWED_SENTENCE} Maya`;

    expect(validateDraftSafety(draft, source)).toEqual({ ok: true });
  });

  it("does not flag scheduling words that are absent from the source (Req 7.2)", () => {
    // The source says nothing about a clinic/office/appointment, yet a reply
    // using those logistics words must stay safe.
    const source = "Reaching out about next week.";
    const draft =
      "I can confirm the appointment. I'll see Dr. Lee at the clinic office then. Maya";

    expect(validateDraftSafety(draft, source)).toEqual({ ok: true });
  });

  it("allows a health term the source message already contains (Req 7.2)", () => {
    const source = "Your test result is ready to pick up at the front desk.";
    const draft = "Thanks, I'll grab the test result on Thursday. Maya";

    expect(validateDraftSafety(draft, source)).toEqual({ ok: true });
  });

  it("exposes HEALTH_TERMS and SCHEDULING_WORDS with the documented members", () => {
    expect(HEALTH_TERMS).toContain("diagnos");
    expect(HEALTH_TERMS).toContain("dementia");
    expect(HEALTH_TERMS).toContain("genetic");
    expect(HEALTH_TERMS).toContain("test result");

    expect(SCHEDULING_WORDS).toContain("appointment");
    expect(SCHEDULING_WORDS).toContain("Dr.");
    expect(SCHEDULING_WORDS).toContain("reschedule");

    // Scheduling words are never health terms.
    for (const word of SCHEDULING_WORDS) {
      expect(HEALTH_TERMS).not.toContain(word);
    }
  });

  it("passes a plain confirmation reply for EVERY inbox message m1–m5 (Req 7.1, 7.2)", () => {
    const reply = "Thursday at 9:40 works for me. See you then. Maya";

    const ids = inbox.map((m) => m.id);
    expect(ids).toEqual(["m1", "m2", "m3", "m4", "m5"]);

    for (const message of inbox) {
      const result = validateDraftSafety(reply, message.body);
      expect(result, `message ${message.id} should pass`).toEqual({
        ok: true,
      });
    }
  });
});
