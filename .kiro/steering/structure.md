# Structure

The repository is currently at the planning/documentation stage; application code is not yet scaffolded. The directories below that exist today are documentation and data; the app layout is the expected target.

## Current layout

```
.
├── .kiro/
│   ├── steering/        # Always-on guidance for AI agents (this folder)
│   └── specs/           # One spec per feature: requirements.md, design.md, tasks.md (source of truth)
├── data/
│   ├── public/          # Open datasets from the Hackachusetts kit — shipped in the public build
│   ├── synthetic/       # Maya's persona + history (see Data rules below)
│   └── private/         # Gitignored; real data only; NEVER read into commits, fixtures, or prompts
├── docs/
│   ├── brief.md                     # Product brief; input for Kiro spec generation
│   └── clinician-summary-fields.md  # CMS care-update template fields for the clinician summary
├── AGENTS.md            # Shared rules for every coding agent (Kiro + Claude Code)
├── CLAUDE.md            # Points Claude Code at AGENTS.md and the steering/spec docs
├── README.md
└── .env.example         # Required environment variables
```

## How work is organized

- **Specs drive implementation.** Each section of `docs/brief.md` becomes one spec under `.kiro/specs/`. Build order: `twin-loop` → `assistant-tasks` → `health-baseline` → `care-outputs`.
- `tasks.md` is the to-do list: implement only tasks listed there, and tick them when done. Read the spec's `design.md` before writing its code.
- If a requirement must change, update the spec in Kiro first — do not edit `requirements.md` from another tool.
- `.kiro/steering/` holds always-on guidance (this folder). `AGENTS.md` holds the shared non-negotiable rules.

## Data rules

- `data/public/` and `data/synthetic/` are the only data used in the public build.
- In `data/synthetic/`, `maya/profile.json`, `maya/vault-entries.json`, `maya/inbox.json` and `checkin-prompts.json` are hand-written. Only `maya/weekly-features.json` is generated, by `scripts/generate-maya.ts` from a fixed seed.
- `data/private/` is gitignored and off-limits to commits, tests, fixtures, and prompts.
- The trial finder uses the ClinicalTrials.gov API v2 at runtime, with the saved slice in `data/public/` as an offline fallback (only RECRUITING studies with a Massachusetts location).

## Application layout

Next.js App Router with TypeScript. Keep all Anthropic/Supabase service-role access in server code, never in the client.

- `app/` — pages, and `app/api/**/route.ts` handlers.
- `components/` — UI components.
- `lib/` — pure logic with no I/O: `score.ts`, `prediction.ts` (`buildPredictionRequest`, `selectPredictionContext`), `check-in.ts` (`buildCheckInResult`, `sessionScore`), `safety.ts` (`SUPPORT_MESSAGE`, `COUNSELOR_MESSAGE`), `speech-features.ts`, `fillers.ts`, `baseline.ts`, `signal.ts` (`detectSignal`, `gate`), `signal-model.ts` (wearable classifier), `drafts.ts`, `trials.ts`, `family.ts`.
- `lib/claude/` — server-only Claude calls, with all prompts in `prompts.ts`.
- `lib/db/` — Supabase access behind repository interfaces, each with an in-memory fake used by tests. For `twin-loop`: `vault-repository.ts` defines the `VaultRepository` interface with `SupabaseVaultRepository` and `InMemoryVaultRepository` implementations.
- `supabase/migrations/` — numbered SQL migrations.
- `scripts/` — `generate-maya.ts`, and `scripts/hooks/` for hook scripts.
- `tests/unit/` and `tests/pbt/`.
- `public/` — manifest and icons.
