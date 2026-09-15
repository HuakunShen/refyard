# 2026-09-15 — Where Git command construction and parsing live

> Record of a design conversation (user asked: should Git command construction and parsing move to
> the browser, is the memory a problem, could the backend become a filtered forwarder that takes
> options from the frontend, and would that make "ship a feature by updating the website" true?).
> **Not a rule in itself** — the settled part moved to the decision log in
> `docs/product/north-star.md`; this file keeps the reasoning and the alternatives that were
> rejected, including the parts of the proposal that were adopted nowhere.

## The proposal

Roughly: put command construction and parsing in the frontend so features ship with the web app;
keep Node/Rust/Go for speed if needed; consider WASM if memory allows; and reduce the backend to an
argument checker that forwards to `git` while filtering malicious parameters.

## What the code already does, which the proposal assumed was missing

- **Intentions cross the boundary; argv never does.** The browser sends semantic fields
  (`kind`, `pathIds`, `contextLines`, `relativeDestination`), and the request schemas are strict
  objects, so `argv`/`cwd`/`env` cannot ride along: `tests/security/negative.test.ts` sends exactly
  those next to a valid operation, asserts the 400, asserts nothing ran, and then submits the same
  body without them and asserts it is accepted. This is stricter than "the frontend fills in
  options" — not even option strings travel.
- **State truth is parsed in core and re-checked before every write.** Snapshots, preview
  fingerprints and `expectedSnapshotId` exist because a client's word about repository state is not
  evidence. That is also what makes the operation result available to a CLI, MCP, or a native
  client later.
- **Display-side computation is already client-side.** `packages/git-graph` (lane layout) is
  imported only by `packages/git-ui` and `apps/web`; the service imports nothing graph-related. A
  bench note that said otherwise was wrong and was corrected (`f358484`).
- **Bounds already exist, as policy numbers:** history 200/500 per page, patch 2 MiB / 20,000 lines
  per file, stdout 16 MiB, object 16 MiB, read cache 64 MiB, deadline classes per command
  (`packages/git-contract/src/limits.ts`). The service does not attempt to stream unbounded Git
  output into a browser.
- **Large things degrade by type, not silently:** `FilePatch` is
  `text | binary | oversize | submodule | unavailable`, each carrying a reason, and the panel says
  "Patch omitted: …" rather than showing a truncated diff as if it were complete.

## Where the proposal was not adopted, and why

**Patch grammar parsing stays in the backend.** The reason is not speed — Node and the browser run
the same V8, and neither is provably faster without a measurement. It is that the parser is
byte-safe, shared with the write paths (staging and discard act on the same path bytes and
fingerprints), and the contract already states the rule: a parsed hunk, "so the UI renders lines
without re-parsing patch grammar". A second implementation in the browser would mean two
interpretations of the same bytes, and the one shown to the user could disagree with the one acted
on. The patch is bounded and fetched per path on demand; it is not the whole repository as JSON.

Where the proposal is right: if a patch over 2 MiB ever needs to be shown, the correct move is a
**controlled streaming read for that shape**, not a parser in the browser.

**The backend does not become a filtering forwarder.** Not because filtering is impossible, but
because the interesting cases are not string checks: `git diff` alone can write files
(`--output`), compare arbitrary paths (`--no-index`), and invoke external programs through diff
drivers and textconv filters, and a permission decision needs the session's scope, the repository's
state, and the operation's target — which is the shape `GitService` already has. A whitelist that
checks subcommands, option combinations, path ranges and write permission _is_ that service with a
worse interface.

## What is genuinely missing

**No diff-scale measurements exist.** `pnpm bench:runtime` measures cold start, status throughput,
history first page and RSS against one 100,000-commit repository; it measures no diff at all — no
latency, no payload size, no peak memory, no oversize-degradation rate. Every argument about
"where parsing should happen" is currently unmeasured on this side.

The measurement that would settle it, in the shapes that break naive implementations: a few large
files, one very long single line, many small changed files, and repeated switching between
repositories; reporting service-side time, response bytes, resident memory before and after, and
how often the oversize path is hit. Until those numbers exist, moving a parser is a guess with a
security cost attached.

## Decisions (moved to the decision log)

1. Command construction, state-truth parsing, and write permission stay in trusted core. This
   restates invariant §2.1 and is not reopened.
2. Display-side parsing stays server-side **because it is bounded**, with typed degradation for
   what does not fit. Moving a specific shape into a browser Worker needs measurements that name
   the shape and show the bound is the problem — not a general preference for thinner backends.
3. The browser gets no parsing Worker until the UI parses something heavy on its own. The largest
   client-side computation today is lane layout for a bounded page of commits.
4. The UI ships with the service, same origin. "Update the site to add a feature" is true for new
   **views** over data the contract already exposes, false for new **permissions** — those need a
   contract change, capability negotiation, and an approval. Hosted UI (form 3) remains a separate,
   opt-in decision.

## The cost this choice carries, stated plainly

Adding a new Git capability means touching the contract schema, a planner, and tests — slower than
letting a page compose flags. That is the trade for a boundary a reviewer can check, and the
mitigation is to keep **contract evolution cheap** (one schema source, generated JSON Schema, plans
as data), not to move argv to the client.

## Triggers that would reopen this

- Measurements showing a _specific_ client-visible shape that the bounded JSON cannot serve
  (likely candidate: patches above 2 MiB) → add a controlled streaming read for that shape.
- A second client (MCP, native host) needing a parse the browser owns → that parse belongs in core,
  because the browser is not a place other clients can read from.
- A hosted UI being adopted (form 3) → a distribution decision, taken separately from parsing.
