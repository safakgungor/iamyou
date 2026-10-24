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
│   ├── synthetic/       # Maya's persona + history, generated from a fixed seed (reproducible)
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
- `data/private/` is gitignored and off-limits to commits, tests, fixtures, and prompts.
- The trial finder uses the ClinicalTrials.gov API v2 at runtime, with the saved slice in `data/public/` as an offline fallback (only RECRUITING studies with a Massachusetts location).

## Expected application layout (once scaffolded)

Next.js App Router with TypeScript. Keep all Anthropic/Supabase service-role access in server code (route handlers / server components), never in the client. A reasonable starting shape:

```
app/            # routes, pages, layouts (App Router)
  api/          # server route handlers — the only place Claude and secrets are used
components/     # UI components (mobile-first, large tap targets, voice-first)
lib/            # clients (Supabase), feature logic, deterministic speech features
public/         # PWA manifest, icons, static assets
tests/          # Vitest unit + fast-check property tests
```
