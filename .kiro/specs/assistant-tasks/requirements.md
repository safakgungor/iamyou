# Requirements Document

## Introduction

The `assistant-tasks` feature is the "second self" of iamyou: the twin acts as an
assistant that reads a synthetic sample inbox and drafts replies in the user's voice.
It covers a read-only synthetic inbox (including an email from a doctor's office),
draft creation grounded in the user's style examples, a draft state machine
(`draft` → `approved` → `sent` or `discarded`), a simulated send that never contacts an
external service, and a draft screen that keeps the user in control.

The non-negotiable rule for this feature is rule 4 in `AGENTS.md`: **nothing is sent
without approval.** The assistant only drafts; a draft reaches `sent` only via `approved`,
and "sent" is simulated — it records a timestamp and never contacts an external service.

The feature is part of the Next.js (App Router, TypeScript) PWA. Pure state-machine logic
lives in `lib/drafts.ts` with no I/O. Draft generation calls Claude only from a server
route. Tests are written with Vitest and property-based tests with fast-check.

All work in this spec obeys the non-negotiable rules in `AGENTS.md` and `.kiro/steering/`:
synthetic data only, never diagnose, nothing sent without approval, synthetic screens are
labelled, and secrets stay server-side.

## Glossary

- **System**: The iamyou `assistant-tasks` application, comprising the Next.js client and its server routes.
- **Inbox_Service**: The part of the System that loads and presents the synthetic sample inbox.
- **Inbox_Message**: A single read-only synthetic message, with the fields `id`, `from`, `subject`, `body`, `received_days_ago`, and `synthetic`.
- **received_days_ago**: An integer field on an Inbox_Message giving the message's age in whole days relative to the request time.
- **relative_time_label**: The human-readable age string derived from `received_days_ago`: `0` renders as "Today", `1` renders as "1 day ago", any integer `N` in the range `2` to `3650` inclusive renders as "N days ago", and any absent, null, non-integer, or negative value renders as an empty string.
- **Draft_Service**: The server route that asks Claude to generate a reply draft in the user's voice.
- **Draft**: A reply the twin composes for an Inbox_Message, holding its text, its `state`, the `message_id` it replies to, and a `sent_at` timestamp that is null until the Draft is sent.
- **draft_state**: The state of a Draft; one of `draft`, `approved`, `sent`, or `discarded`.
- **draft_event**: An input to the state machine; one of `approve`, `send`, `discard`, or `edit`.
- **transition**: The pure function `transition(state, event)` in `lib/drafts.ts` that maps a current `draft_state` and a `draft_event` to the next `draft_state`, with no I/O and no mutation of its inputs.
- **terminal_state**: A `draft_state` from which no `draft_event` produces a different state; `sent` and `discarded` are terminal_states.
- **style_example**: A `vault_entries` row whose `kind` equals `style_example`, holding an example of how the user writes.
- **Draft_Screen**: The UI surface that shows a Draft and its controls.
- **Approval_Notice**: The fixed text "Nothing is sent without your approval." shown on the Draft_Screen.
- **Synthetic_Label**: A visible "Synthetic data" label shown on any screen that displays synthetic persona or history data.
- **sent_at**: The timestamp recorded on a Draft when the Draft enters the `sent` state.

## Requirements

### Requirement 1: Read-only synthetic inbox

**User Story:** As a user, I want a sample inbox of realistic messages, including one from my doctor's office, so that I can ask the twin to help me reply.

#### Acceptance Criteria

1. WHEN a user requests the inbox, THE Inbox_Service SHALL read the Inbox_Message collection from `data/synthetic/maya/inbox.json` at request time and return all messages present in that file.
2. THE Inbox_Service SHALL NOT write or copy any Inbox_Message into any database table.
3. THE Inbox_Service SHALL present each returned Inbox_Message with all six fields `id`, `from`, `subject`, `body`, `received_days_ago`, and `synthetic` populated from the source file, where `received_days_ago` is a non-negative integer and `synthetic` equals true.
4. THE Inbox_Service SHALL include an Inbox_Message whose `from` equals "Dr. Lee's office, Valley Family Medicine" and whose `body` asks the user to confirm or reschedule an appointment.
5. WHERE a screen displays the inbox or an Inbox_Message, THE System SHALL display on that screen a Synthetic_Label containing the text "Synthetic data".
6. IF the file `data/synthetic/maya/inbox.json` cannot be read or cannot be parsed as a valid Inbox_Message collection, THEN THE Inbox_Service SHALL return no Inbox_Messages and provide an error indication that the synthetic inbox is unavailable, without writing any data to the database.

### Requirement 2: Relative time rendering

**User Story:** As a user, I want each message to show how long ago it arrived in plain words, so that I can see at a glance which messages are recent.

#### Acceptance Criteria

1. WHEN an Inbox_Message has `received_days_ago` equal to `0`, THE Inbox_Service SHALL render its relative_time_label as "Today".
2. WHEN an Inbox_Message has `received_days_ago` equal to `1`, THE Inbox_Service SHALL render its relative_time_label as "1 day ago".
3. WHEN an Inbox_Message has `received_days_ago` equal to an integer `N` in the range `2` to `3650` inclusive, THE Inbox_Service SHALL render its relative_time_label as "N days ago", substituting the decimal integer value of `N`.
4. IF an Inbox_Message has `received_days_ago` absent, null, non-integer, or less than `0`, THEN THE Inbox_Service SHALL render its relative_time_label as an empty string and SHALL continue rendering the remaining Inbox_Message fields without raising an error.

### Requirement 3: Draft creation in the user's voice

**User Story:** As a user, I want the twin to draft a reply in my own voice, so that I can send something that sounds like me with minimal effort.

#### Acceptance Criteria

1. WHEN the user asks the twin to reply to an Inbox_Message by voice, THE Draft_Service SHALL create a Draft addressed to that Inbox_Message.
2. WHEN the user asks the twin to reply to an Inbox_Message by button, THE Draft_Service SHALL create a Draft addressed to that Inbox_Message.
3. WHEN the Draft_Service creates a Draft, THE Draft_Service SHALL ground the draft text in at most 5 vault entries whose `kind` equals `style_example`, selected from the vault entries available for that user.
4. WHILE no vault entry whose `kind` equals `style_example` exists for the user, WHEN the Draft_Service creates a Draft, THE Draft_Service SHALL generate the draft text without style grounding and still create the Draft.
5. WHEN the Draft_Service creates a Draft, THE Draft_Service SHALL set the Draft's `draft_state` to `draft`.
6. THE Draft_Service SHALL call Claude only from a server route.
7. IF the Claude call fails or does not return a draft within 30 seconds, THEN THE Draft_Service SHALL not create a Draft and SHALL return an error response indicating that draft generation failed.

### Requirement 4: Draft state machine

**User Story:** As a user, I want a predictable set of draft states with clear transitions, so that I always know whether something can still be changed or has been sent.

#### Acceptance Criteria

1. THE System SHALL represent a Draft's `draft_state` as exactly one of `draft`, `approved`, `sent`, or `discarded`.
2. WHEN `transition` receives the state `draft` and the event `approve`, THE System SHALL return the state `approved`.
3. WHEN `transition` receives the state `approved` and the event `send`, THE System SHALL return the state `sent`.
4. WHEN `transition` receives the state `draft` and the event `discard`, THE System SHALL return the state `discarded`.
5. WHEN `transition` receives the state `approved` and the event `discard`, THE System SHALL return the state `discarded`.
6. WHEN `transition` receives the state `approved` and the event `edit`, THE System SHALL return the state `draft`.
7. IF `transition` receives the state `draft` and the event `send`, THEN THE System SHALL return the state `draft` unchanged. _(Property P1)_
8. WHILE a Draft is in the `sent` state, THE System SHALL return the `sent` state unchanged for every `draft_event`. _(Property P3)_
9. WHILE a Draft is in the `discarded` state, THE System SHALL return the `discarded` state unchanged for every `draft_event`. _(Property P3)_
10. THE transition function SHALL be a pure function that returns a `draft_state` and SHALL NOT mutate the inbox or any Inbox_Message. _(Property P2)_
11. IF `transition` receives a valid `draft_state` and a valid `draft_event` for which no transition in criteria 2 through 9 is defined, THEN THE System SHALL return the received state unchanged. _(Property P1)_
12. IF `transition` receives a value that is not a valid `draft_state` or a value that is not a valid `draft_event`, THEN THE System SHALL return an error indication and SHALL NOT mutate any input. _(Property P2)_

### Requirement 5: Simulated send

**User Story:** As a user, I want "send" to be a safe simulation in this demo, so that nothing ever leaves the app to a real recipient.

#### Acceptance Criteria

1. WHEN a Draft enters the `sent` state, THE System SHALL record a `sent_at` timestamp on that Draft set to the server clock time at the moment the state transition completes, with millisecond precision.
2. WHEN a Draft enters the `sent` state, THE System SHALL complete the transition using only in-application state and SHALL NOT open any outbound network connection or invoke any external service.
3. WHILE a Draft's `draft_state` is any value other than `sent`, THE System SHALL keep that Draft's `sent_at` null.
4. IF recording the `sent_at` timestamp fails during a transition to the `sent` state, THEN THE System SHALL reject the transition, retain the Draft's prior `draft_state`, keep `sent_at` null, and return an error indication that the send could not be completed.

### Requirement 6: Draft screen controls and labels

**User Story:** As a user, I want the draft screen to remind me that I am in control and that the data is synthetic, so that I trust what the assistant does.

#### Acceptance Criteria

1. WHILE the Draft_Screen is displayed, THE Draft_Screen SHALL show the Approval_Notice text "Nothing is sent without your approval."
2. WHILE the Draft_Screen is displayed, THE Draft_Screen SHALL show the Synthetic_Label text "Synthetic data".
3. WHEN the user edits a Draft that is in the `approved` state, THE System SHALL apply the `edit` event and return the Draft to the `draft` state.
4. WHILE a Draft is in the `draft` state, THE Draft_Screen SHALL offer a control to approve the Draft and a control to discard the Draft.
5. WHEN the user activates the approve control on a Draft in the `draft` state, THE System SHALL move the Draft to the `approved` state and indicate the approved state on the Draft_Screen.
6. WHEN the user activates the discard control on a Draft in the `draft` state, THE System SHALL remove the Draft and SHALL NOT send its contents.

### Requirement 7: Safety constraints on draft content

**User Story:** As a user with a family history of a hereditary condition, I want the twin's drafts to stay free of diagnostic or added health claims, so that my messages never overstate or misstate my health.

#### Acceptance Criteria

1. THE Draft_Service SHALL NOT state or imply in the draft text that the user has, had, is likely to have, or is at risk of any medical condition, diagnosis, or health outcome.
2. THE Draft_Service SHALL NOT include any health information in the draft text beyond the health information already present in the Inbox_Message being replied to.
3. WHERE the Draft_Service includes health-related guidance in a draft, THE Draft_Service SHALL use no wording stronger than "You might want to talk to your doctor about this." and SHALL NOT include any additional recommendation, instruction, or interpretation regarding that guidance.
4. WHEN the Draft_Service produces a draft, THE Draft_Service SHALL validate the draft text against criteria 1 through 3 before the draft is presented to the user.
5. IF a draft fails validation against criteria 1 through 3, THEN THE Draft_Service SHALL withhold that draft text from the user and SHALL produce a replacement draft that satisfies criteria 1 through 3 before any draft is presented to the user.

## Correctness Properties

These properties are carried into design and verified with fast-check. Each is attached to
the requirement(s) it governs.

- **P1 — Send only from approved.** For any sequence of `draft_event` values applied through `transition` starting from `draft`, a Draft reaches the `sent` state only on a `send` event applied to the `approved` state; no other path reaches `sent`. _(Requirement 4)_
- **P2 — transition is pure and does not mutate the inbox.** `transition(state, event)` returns a `draft_state` without mutating its inputs, the inbox, or any Inbox_Message, for every state and event. _(Requirements 4, 1)_
- **P3 — Terminal states are terminal.** For the states `sent` and `discarded` and every `draft_event`, `transition` returns the same state it was given. _(Requirement 4)_

## Out of Scope

The following are explicitly out of scope for the `assistant-tasks` spec and are handled by other specs:

- The predict-and-correct loop, the vault data model and row-level security, voice check-in, grading, and the similarity score (covered by `twin-loop`).
- Real email, calendar, or messaging integration — "send" is simulated only (see the brief's Out of scope).
- Health and baseline features, including speech and wearable features, personal baseline, and change signals (covered by `health-baseline`).
- Care outputs: the clinician summary, the trial finder, and family mode (covered by `care-outputs`).
