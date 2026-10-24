# iamyou

A digital twin that grows with you from age 18, thinks like you and works for you. For people with a family history of hereditary brain disease, it also builds, with consent, the healthy baseline that medicine and wearables never get to see.

Built for Hackachusetts 2026 · Healthcare & Biotech.

- **Live:** [iamyou.si](https://www.iamyou.si) · the app is at [iamyou.si/app](https://www.iamyou.si/app). Tap **Try as Maya**; no account needed.
- **Film:** on the landing page, chapter 05.

## Try it in two minutes

1. Open [iamyou.si/app](https://www.iamyou.si/app) on a phone and tap **Try as Maya**.
2. **Check-in.** The twin answers today's question first, as Maya, and hides its guess. Answer by voice or text, see how close it came, and correct it in one sentence.
3. **Second self.** Open the inbox and let the twin draft a reply to Dr. Lee's office in Maya's voice. Nothing leaves without approve and send.

Maya is a synthetic persona. The wearable examples are real, de-identified research recordings from PhysioNet, labelled as such.

## Built with Kiro

Kiro wrote the plan and most of the code. Every spec lives in [`.kiro/specs/`](.kiro/specs), written requirements-first in EARS, then designed, broken into tasks and executed with **Run all Tasks**.

| Spec | What Kiro produced |
| --- | --- |
| `twin-loop` | Requirements, design, 20 tasks: scaffold, pure logic, Supabase schema with RLS, the server-only Claude layer, six routes, tests |
| `assistant-tasks` | Requirements, design, 13 tasks: draft state machine, synthetic inbox, drafts table, safety check, three routes, tests |
| `health-baseline` | Requirements, design, 18 tasks: speech features, frozen personal baseline, change signal, right-not-to-know gate, Maya's 22-year history |
| `care-outputs` | Requirements, design, 14 tasks: clinician summary, trial finder, family mode |

- **Steering** ([`.kiro/steering/`](.kiro/steering)) carries product, tech, structure and safety rules into every Kiro session.
- **Hooks** ([`.kiro/hooks/`](.kiro/hooks)): unit tests on save, property tests after each task, a guard that blocks writes to private data and `.env` files, and a session log in [`KIRO_LOG.md`](KIRO_LOG.md).
- **Property-based tests.** Every rule that can be stated as a property has one: the twin's guess never leaks before the answer, crisis handling wins over everything else, a draft reaches `sent` only through `approved`, deleting the vault removes every row of that user.
- **In the history.** Commits made from Kiro's output end with `Generated-by: Kiro IDE` (`git log --grep "Generated-by: Kiro"`). They hold about three quarters of the code and spec lines.

Claude Code built the screens and the landing page, reviewed each Kiro run, and made the fixes, each named in its commit as "Adjusted outside Kiro (Claude Code)". [`AGENTS.md`](AGENTS.md) holds the rules both agents follow.

## iamyou Signal

Our own wrist model, trained on the PhysioNet wearable dataset: from one 30-second window, judged against the person's own seated baseline, it tells rest, stress and exercise apart. Evaluated leave-one-person-out on 33 people: balanced accuracy 0.77, 94% of exercise recognised, and the personal baseline beats a population model. See [`docs/signal-model.md`](docs/signal-model.md).

## Safety

The twin never diagnoses; the strongest wording anywhere is "You might want to talk to your doctor about this." Crisis language gets professional support (988), and genetic-testing questions go to a genetic counselor. Every change signal passes the user's right-not-to-know setting. Drafts are only drafts until approved. Synthetic screens say so.

## Stack

Next.js 16 (App Router, TypeScript) as a PWA on Vercel · Supabase Postgres with row-level security and anonymous demo sign-in · Claude (`claude-opus-5-5`) from server routes only · Vitest and fast-check · three.js and GSAP for the landing.

## Run locally

```bash
npm install
cp .env.example .env.local   # add your Anthropic and Supabase keys
npm run dev
```

Apply the SQL files in [`supabase/migrations/`](supabase/migrations) in order, and enable anonymous sign-in in Supabase Auth. Tests: `npm run test:unit`, `npm run test:pbt`, `npm run lint`.

## Data

Sources, licences and attribution: [`data/README.md`](data/README.md). No real personal data is used.
