# 2026-09-15 — citty for the CLI parser; Effect deferred with triggers

> Record of a design conversation (user asked: use an existing argparse library such as citty
> instead of the hand-written parser, and should the CLI's underpinnings move to Effect?).
> The parser half was adopted the same day; Effect was decided against for V1 with explicit
> revisit triggers. Status: **decision recorded; the parser decision is implemented
> (`apps/cli/src/args.ts`), the Effect decision is a commitment not to act yet.** The same
> question came back the same day, narrower — is the *polling* the part that should have been
> Effect? — and is answered at the end of this file.

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

## Later the same day — is the polling the piece that should have been Effect?

The question came back narrower: the background polling had just landed, and "Effect has that
built in", so would it be better there? Re-asking it was the right instinct — a cadence, an
admission-control queue and a supervised process tree are all things Effect has an answer for
— so the honest way to answer is to price *this* code, not to restate the earlier decision.

**Nothing has been renamed to Effect, and the reason is what the pieces turn out to be.**

The polling itself is not Effect-shaped at all. `apps/web/src/lib/background-poll.ts` is 129
lines of arithmetic — which interval for a visible page, which for a hidden one, which for a
repository whose reads take longer than the interval — plus a map from query key to last read
duration. Effect's `Schedule`, `Stream.tick` or a repeating fiber would replace the timer and
none of the rules; and adopting it in the browser means shipping the Effect runtime into the
SPA, next to TanStack Query, which is the thing that actually owns the cadence, the cache, the
deduplication of simultaneous readers and the invalidate-on-event refresh. Two schedulers for
one cache is strictly worse than one, whatever the second one is written in.

The server-side substrate is the same story with more lines. Measured in this tree: admission
control is `packages/host-node/src/coordinator/queue.ts` (252 lines, three counters and a
writer set); the job lifecycle is `jobs.ts` (598 lines) where the ordering that matters is
*append to the journal first, then say the state changed* (`jobs.ts:208-262` — a transition
whose append fails is reported as `unknown`, never as done); timeouts live only in the process
runner (`process/runner.ts:45-51`, 285 lines, 19 unit tests including the single-settlement
race); and the event ring is a bounded array plus a listener set (`http/events.ts`, 246 lines).
There are **no retries anywhere** in the host, by rule (`jobs.ts:21`, `runner.ts:23`) — an
uncertain write is reported as unknown, never replayed — so the `Schedule`-shaped code that
Effect would delete does not exist. The one backoff in the workspace is the SSE reconnect in
the browser client (`packages/git-client/src/events.ts:94-96`, ten lines with an injectable
clock and six tests), and it is client-side.

What Effect would actually add is *interruption*: a fiber tree where a parent's cancellation
reaches every child, with finalizers that run in order. That is the one thing this codebase
does not have — there is no `AbortSignal` anywhere in `packages/host-node`, and a running
mutation cannot be cancelled at all (`jobs.ts:511` refuses it deliberately). That gap is
not an oversight Effect could close for free: interrupting a Git process group mid-write is
exactly the situation the safety rules classify as `unknown`, which is why cancellation is
queued-only and why the shutdown path lets in-flight work finish
(`http/server.ts:828-844`) instead of killing it. Buying a fiber tree to then forbid its
central operation would be paying for the feature we must not use.

So the earlier decision stands, and trigger 1 is explicitly **not** fired by T08: the mutation
engine was built, and it wanted the journal, the queue and the ring — all three of which
already existed — not a scheduler. What would fire it: a round that needs cancellation of
*running* work with progress reporting (a long `fetch`/`push` the user can stop and then
reconcile), or a persistent daemon with supervised background work. Either would be scheduled
as its own task, scoped to `packages/host-node`, with `runPromise` at the edges, core plain,
Zod still the contract — and the version pinned exactly, upgraded in its own change.
