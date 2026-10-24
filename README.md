# iamyou

A digital twin that grows with you from age 18, thinks like you and works for you. For adults with a family history of hereditary neurodegenerative disease, it also builds, with consent, the healthy baseline that medicine never gets to see.

Built for Hackachusetts 2026, Healthcare & Biotech track.

> **Status:** in development during the hackathon. All persona and history data in this repository is synthetic.

## Demo

- Live demo: _link coming_. Tap **Try as Maya** to explore without an account.
- Demo video: _link coming_.

## How it works

1. **Predict and correct.** In a short voice check-in, the twin predicts how you will answer. You correct it in one sentence, and a similarity score shows how well it knows you.
2. **Second self.** It drafts messages in your voice and waits for your approval.
3. **Health layer (opt-in).** From the same conversations and wearable data, it builds your personal baseline. If you drift from it for weeks, and only if you chose to know, it suggests talking to your doctor and prepares a one-page summary. It never diagnoses.

## Run locally

_Instructions will be added as the project is scaffolded._ See `.env.example` for the required environment variables.

## Built with Kiro

Specs, steering docs and hooks live in [`.kiro/`](.kiro). Product context for the specs is in [`docs/brief.md`](docs/brief.md), and rules shared by every coding agent are in [`AGENTS.md`](AGENTS.md).

## Data sources

See [`data/README.md`](data/README.md). No real personal data is used.
