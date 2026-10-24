# AGENTS.md

Shared rules for every coding agent working in this repository: Kiro and Claude Code read this file. Product context lives in `docs/brief.md`; specs in `.kiro/specs/` are the source of truth for what gets built.

## What iamyou is

A voice-first digital twin that grows with a person from age 18. It learns how they think through one loop (it predicts, the user corrects, it learns), works for them as an assistant, and, for adults with a family history of hereditary neurodegenerative disease, builds a healthy baseline so that change can be noticed early and shared with a clinician.

## Non-negotiable rules

1. **Synthetic data only.** No real personal data in the repo, the demo or the tests. Real data, if any, stays in `data/private/`, which is gitignored and must never be read into commits, fixtures or prompts.
2. **Never diagnose.** UI copy and model prompts never say a user has, or is likely to have, a condition. The strongest allowed wording is "You might want to talk to your doctor about this."
3. **Right not to know.** Every change signal passes through the user's setting: `tell_me`, `doctor_only` or `record_only`. With `record_only`, nothing about a change is ever shown to the user. With `doctor_only`, it appears only in the clinician summary.
4. **Nothing is sent without approval.** The assistant only drafts. Sending requires an explicit user action.
5. **Label synthetic screens.** Any screen showing synthetic history or persona data shows a visible "Synthetic data" label.
6. **Crisis and genetics.** If a user expresses crisis, point to professional support. Questions about genetic testing go to a genetic counselor; the twin never interprets a test result.
7. **Secrets stay server-side.** API keys are used only in server code. Never commit `.env` files.

## How we work

- Implement only tasks listed in a spec's `tasks.md`, and tick them when done. If a requirement needs to change, update the spec in Kiro first; do not edit `requirements.md` from another tool.
- Read the relevant spec's `design.md` before writing code for it.
- Commit messages start with the spec and task, e.g. `twin-loop 2.1: similarity score`.
- Every rule above that can be expressed as a property gets a property-based test.
- Everything in the repo (code, UI, docs) is in English.

## Stack

- Next.js (App Router, TypeScript), installable as a PWA, deployed on Vercel.
- Supabase: Postgres with row-level security for the vault, Supabase Auth, plus a "Try as Maya" demo mode that needs no login.
- Claude via the Anthropic API, called only from server routes.
- Tests: Vitest for unit tests, fast-check for property-based tests.
