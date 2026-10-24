# Tech

## Stack

- **Framework:** Next.js (App Router) with TypeScript, installable as a PWA (web app manifest and icons only — no custom service worker), deployed on Vercel.
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

## Supabase

- Browser and server clients use `@supabase/ssr`.
- Row-level security is on for every table, keyed on `auth.uid()`.
- "Try as Maya" uses Supabase anonymous sign-in (already enabled on the project).
- The service-role key is used only in `POST /api/demo/start`, to seed the caller's own rows.

## Claude API

- SDK `@anthropic-ai/sdk`, server-only code in `lib/claude/`, model `"claude-opus-5-5"`.
- JSON results come from `client.messages.parse` with `zodOutputFormat` from `"@anthropic-ai/sdk/helpers/zod"`; zod schemas for every request and response.
- `output_config.effort` is `"low"` for spoken replies and email drafts, `"medium"` for grading and family-mode answers.
- Check `stop_reason === "refusal"` before reading content, and return a safe fallback message.
- The spoken-reply route uses `client.beta.messages.create` with `betas ["server-side-fallback-2026-07-01"]` and `fallbacks: "default"`.
- Never send `temperature`, `top_p` or `top_k`. Never use assistant prefill.

## Voice

- Speech-to-text via the Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`).
- Text-to-speech via `speechSynthesis`.
- Fall back to a text input when recognition is unsupported.

## Conventions

- Everything in the repo (code, UI, docs) is in English.
- Every non-negotiable rule that can be expressed as a property gets a **property-based test** (fast-check). Example properties: similarity score always in [0, 1]; a draft never reaches `sent` without `approved`; a single-day deviation never triggers a change signal; the same transcript always yields the same speech-feature values.
- Speech features (type-token ratio, mean sentence length, filler-word rate) are computed deterministically in code, **not** by the model.
- Named constants for signal thresholds (deviation must persist ≥ 3 weeks across ≥ 2 features).
- Commit messages start with the spec and task, e.g. `twin-loop 2.1: similarity score`.

## Common commands

The package manager is **npm** (the lock file is `package-lock.json`).

```bash
npm install            # install dependencies
npm run dev            # start the local dev server (run manually in a terminal)
npm run build          # production build
npm run test:unit      # unit tests (vitest run tests/unit)
npm run test:pbt       # property-based tests (vitest run tests/pbt)
npm run lint           # typecheck (tsc --noEmit)
```
