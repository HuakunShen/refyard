# Workbench UI and Sessions

**Updated: 2026-09-23** — page created; UI/session decisions from `.journal/2026-09-15.md`, recent deltas from git log.

## Theme: shadcn Neutral (journal 2026-09-15)

- **Decision:** authentic shadcn Neutral / Zinc grayscale (chroma 0) over slate/blue-tinted tokens, per explicit user request — no cold blueish tones.
  - Light: `oklch(1 0 0)` canvas, `#e5e5e5` borders, `#18181b` charcoal primary.
  - Dark: `#0a0a0a` background, `#171717` card, `#262626` border.
- Blue remains available as an **opt-in accent preset**.
- Components come from shadcn-svelte; logo work landed in `packages/logo` (v2 mark still untracked as `refyard-mark-v2.png`).

## Session persistence (same journal entry)

- **Problem:** bearer token in `sessionStorage` only → session lost whenever tabs close; old links with spent tickets hit 401 loops.
- **Decision:** store bearer + `serviceInstanceId` in **both** `localStorage` and `sessionStorage`. `negotiateSession` re-validates the instance against `/health` and wipes expired/restarted sessions — so a token (8h host lifetime) is reused safely across tabs and restarts.
- **`?pair=` lifecycle:** always strip via `history.replaceState` in `finally` (not only on success) and ignore a spent ticket when a valid session token is already active for this instance. Leaving it caused infinite failure loops on reload.
- Guidance lives in `ConnectionPanel`: press `p` + Enter on the serving terminal to print a fresh ticket.

## Recent UI deltas

- **Settings dialog** (`packages/git-ui/src/components/SettingsDialog.svelte`) — modified 2026-09-22/23 alongside the provider connect flow (working tree had an uncommitted edit at bootstrap time).
- **Pull-requests panel** — gated sidebar view + host-side connect flow (`efcb10c`).
- **Native zoom shortcuts** enabled in the desktop app (`4da2d7a`).
- Earlier: drop-commit (`1aa3cd0`) and squash-tip (`9b86fc3`) context-menu actions with e2e coverage.

## Related pages

- `Services/Git Provider Integration.md` — the connect flow this dialog gained
- `Services/Node CLI and HTTP Service.md` — what `/health` negotiation checks
