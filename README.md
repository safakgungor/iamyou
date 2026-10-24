# iamyou

A digital twin that grows with you from age 18, thinks like you and works for you. For people with a family history of hereditary brain disease, it also builds, with consent, the healthy baseline that medicine and wearables never get to see.

Built for Hackachusetts 2026 · Healthcare & Biotech.

- **Live:** [iamyou.si](https://www.iamyou.si) · the app is at [iamyou.si/app](https://www.iamyou.si/app). Tap **Try as Maya**; no account needed.
- **Film:** on the landing page, chapter 05.

## Try it in five minutes

1. Open [iamyou.si/app](https://www.iamyou.si/app) on a phone and tap **Try as Maya**. You land on **Today**; the tab bar holds **Today**, **Mind**, **Health** and **Care**.
2. **Check-in.** The twin answers today's question first, as Maya, and hides its guess. Answer by voice or text, see how close it came, and correct it in one sentence. The twin speaks in the film's voice.
3. **Second self.** Open the inbox and let the twin draft a reply to Dr. Lee's office in Maya's voice. Nothing leaves without approve and send.
4. **Mind.** The mind tree ([`/mind`](https://www.iamyou.si/mind)) maps everything the twin has learned from Maya into five branches and grows a leaf with every correction. Tap a leaf to see the entries it came from, or ask it about yourself by voice or text.
5. **Health.** Maya's timeline from 18 to 40, week by week against her own baseline. Choose who hears about a change, the right-not-to-know control; the county card adds CDC context. The wrist signal ([`/real-signal`](https://www.iamyou.si/real-signal)) runs our model on real PhysioNet recordings.
6. **Care.** Studies recruiting in Massachusetts for the family condition, and family mode: the people Maya chose ask how she would answer and get her own words back.
7. **Consent & settings**, from Today: family history, the health layer, and who hears about a change.

Maya is a synthetic persona. The wearable examples are real, de-identified research recordings from PhysioNet, labelled as such.

## Built with Kiro

Kiro wrote the plan and most of the code. All four specs live in [`.kiro/specs/`](.kiro/specs), written requirements-first in EARS, then designed and broken into tasks. Kiro implemented three of them with **Run all Tasks**; Claude Code implemented the fourth from Kiro's spec.

| Spec | Tasks | What it covers | Implemented by |
| --- | --- | --- | --- |
| `twin-loop` | 20 | Scaffold, pure logic, Supabase schema with RLS, the server-only Claude layer, six routes, tests | Kiro, Run all Tasks |
| `assistant-tasks` | 13 | Draft state machine, synthetic inbox, drafts table, safety check, three routes, tests | Kiro, Run all Tasks |
| `health-baseline` | 18 | Speech features, frozen personal baseline, change signal, right-not-to-know gate, Maya's 22-year history | Kiro, Run all Tasks |
| `care-outputs` | 14 | Clinician summary, trial finder, family mode | Claude Code, from Kiro's spec |

- **Steering** ([`.kiro/steering/`](.kiro/steering)) carries product, tech, structure and safety rules into every Kiro session.
- **Hooks** ([`.kiro/hooks/`](.kiro/hooks)): unit tests on save, property tests after each task, a guard that blocks writes to private data and `.env` files, and a session log in [`KIRO_LOG.md`](KIRO_LOG.md).
- **Property-based tests.** Every rule that can be stated as a property has one: the twin's guess never leaks before the answer, crisis handling wins over everything else, a draft reaches `sent` only through `approved`, deleting the vault removes every row of that user, the mind tree cites only the user's own entries. 48 property tests run next to 371 unit tests.
- **In the history.** Commits made from Kiro's output end with `Generated-by: Kiro IDE` (`git log --grep "Generated-by: Kiro"`). Those 15 commits hold about 60% of the code, test and spec lines.

Claude Code built the landing page and the screens around Kiro's logic: the phone shell and tabs, the timeline screen, the wrist signal, the mind tree, consent & settings, and the twin's voice. It also reviewed each Kiro run and made the fixes, each named in its commit as "Adjusted outside Kiro (Claude Code)". [`AGENTS.md`](AGENTS.md) holds the rules both agents follow.

## iamyou Signal

Our own wrist model, trained on the PhysioNet wearable dataset: from one 30-second window, judged against the person's own seated baseline, it tells rest, stress and exercise apart. Evaluated leave-one-person-out on 33 people: balanced accuracy 0.77, 94% of exercise recognised, and the personal baseline beats a population model. See [`docs/signal-model.md`](docs/signal-model.md).

## Safety

The twin never diagnoses; the strongest wording anywhere is "You might want to talk to your doctor about this." Crisis language gets professional support (988), and genetic-testing questions go to a genetic counselor. Every change signal passes the user's right-not-to-know setting. Drafts are only drafts until approved. Synthetic screens say so.

## Stack

Next.js 16 (App Router, TypeScript) as a PWA on Vercel · Supabase Postgres with row-level security and anonymous demo sign-in · Claude (`claude-opus-5-5`) from server routes only · ElevenLabs for the twin's voice · Vitest and fast-check · three.js and GSAP for the landing and the mind tree.

## Run locally

```bash
npm install
cp .env.example .env.local   # add your Anthropic and Supabase keys; ElevenLabs is optional
npm run dev
```

Apply the SQL files in [`supabase/migrations/`](supabase/migrations) in order, and enable anonymous sign-in in Supabase Auth. Tests: `npm run test:unit`, `npm run test:pbt`, `npm run lint`.

## Data

Sources, licences and attribution: [`data/README.md`](data/README.md). No real personal data is used.
