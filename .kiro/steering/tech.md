# Tech

## Stack

- **Framework:** Next.js (App Router) with TypeScript, installable as a PWA (manifest + service worker), deployed on Vercel.
- **Backend / data:** Supabase — Postgres with row-level security for the per-user vault, Supabase Auth, plus a "Try as Maya" demo mode that needs no login.
- **AI:** Claude via the Anthropic API, called **only from server routes** — never from the client.
- **Testing:** Vitest for unit tests, fast-check for property-based tests.

> Note: at the time of writing the app is not yet scaffolded. Follow this stack when setting it up; update this file if the actual setup diverges.

## Environment variables

Defined in `.env.example` (copy to `.env.local`; never commit `.env` files):

- `ANTHROPIC_API_KEY` — server-only.
- `NEXT_PUBLIC_SUPABASE_URL` — public.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — public.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, never exposed to the client.

Secrets stay server-side: API keys and the service-role key are used only in server code.

## Conventions

- Everything in the repo (code, UI, docs) is in English.
- Every non-negotiable rule that can be expressed as a property gets a **property-based test** (fast-check). Example properties: similarity score always in [0, 1]; a draft never reaches `sent` without `approved`; a single-day deviation never triggers a change signal; the same transcript always yields the same speech-feature values.
- Speech features (type-token ratio, mean sentence length, filler-word rate) are computed deterministically in code, **not** by the model.
- Named constants for signal thresholds (deviation must persist ≥ 3 weeks across ≥ 2 features).
- Commit messages start with the spec and task, e.g. `twin-loop 2.1: similarity score`.

## Common commands

The project is not yet scaffolded, so exact scripts may change. Expected commands once set up with npm:

```bash
npm install            # install dependencies
npm run dev            # start the local dev server (run manually in a terminal)
npm run build          # production build
npm run start          # serve the production build
npm test               # run Vitest unit + property-based tests
npm run lint           # lint
```

Verify the actual script names in `package.json` once it exists before relying on them.
