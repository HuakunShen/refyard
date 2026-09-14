# 2026-09-15 — citty for the CLI parser; Effect deferred with triggers

> Record of a design conversation (user asked: use an existing argparse library such as citty
> instead of the hand-written parser, and should the CLI's underpinnings move to Effect?).
> The parser half was adopted the same day; Effect was decided against for V1 with explicit
> revisit triggers. Status: **decision recorded; the parser decision is implemented
> (`apps/cli/src/args.ts`), the Effect decision is a commitment not to act yet.**

## The parser: adopted (citty 0.2.2)

The hand-written loop (~120 lines) was correct and tested, but tokenising arguments is
commodity work that a maintained parser does better — value consumption, `--no-` negation,
camel-case mirrors. citty's low-level `parseArgs(rawArgs, argsDef)` slots under the existing
`parseArgs(argv, cwd) → ParseResult` API, so `main.ts` and the tests did not change shape.

One finding justified the migration concern in the first place: **citty is permissive by
design.** `refyard open --depth 5` parses to `depth: true` with `5` demoted to a positional —
a repository named "5" would be opened without complaint. The strictness therefore moved up a
layer rather than disappearing: every parsed key is checked against the declared set and
anything unknown is named and refused; `--port`/`--ticket-ttl` values are validated in full.
The grammar is citty's job; the rules are ours.

## Effect: deferred, with triggers

The advice under consideration was: plain-TypeScript domain + Effect application runtime +
Hono adapter — and "switch now, while the backend is small", because migration cost rises as
more backend is written. That criterion is sound but it rested on a factual assumption that
does not hold here: **the orchestration substrate it wants Effect for already exists and is
tested.** Process lifecycle with timeout and cleanup, the one-writer-per-repository queue,
the journal with restart-to-unknown recovery, the SSE event ring — that is
`packages/host-node` at 405 passing tests, not a scaffold.

Deciding **against** for V1, because:

- adopting Effect properly means migrating that substrate (not wrapping it in
  `Effect.tryPromise` at the edges — the half-adopted state the advice itself calls the worst
  outcome), and that lands exactly on the safety-critical layer immediately before the
  mutation work that depends on it;
- Effect 4 is still a release candidate, and this repository pins exact, supply-chain-vetted
  versions;
- the domain core (`git-core`, `git-graph`) must stay plain TypeScript regardless — that part
  of the advice agrees with the north star's form 4 and changes nothing.

**Revisit triggers** — any one of these is the moment to schedule "application layer on
Effect" as its own task, before more orchestration is written on top of the current one:

1. The T08 mutation engine needs cancellation/progress/timeout wiring that goes beyond what
   the queue + journal + event ring already model — adopt before T09–T12 pile on.
2. A persistent daemon / `install-service` round is committed to (long-lived supervision,
   background fetch, restart supervision).
3. Effect 4 reaches stable and passes this repository's supply-chain policies.

If adopted later, the boundaries hold: core stays plain; Hono stays the HTTP adapter; Zod
stays the contract; the application layer is Effect-native inside itself with `runPromise`
only at its edges; and the version is pinned exactly, upgraded in its own change.
