# Workbench Mutation Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move write gating, operation submission/follow, mutation messages, capability-derived controls, and semantic Git mutation handlers out of `+page.svelte` without changing any Git intention or UI behavior.

**Architecture:** Pure mutation-model helpers describe capability availability and write refusal messages. `mutations.svelte.ts` owns the reactive mutation application layer: mutation client, busy/messages, fresh snapshot targets, preview tokens, operation following, post-write invalidation, workspace creation/access, and the existing semantic panel callbacks. The page remains responsible for session negotiation, layout, and wiring panels to controller methods.

**Tech Stack:** Svelte 5 runes, TypeScript, `@refyard/git-client`, TanStack Query, Vitest, Playwright.

**Spec:** `docs/product/git-client-direction.md` §13 and Phase B

## Global Constraints

- Every existing mutation payload is preserved byte-for-byte in meaning; no new raw Git surface is introduced.
- Writes remain fail-closed while offline, unpaired, incompatible, or read-only-compatible; no write is queued or replayed.
- Worktree/repository writes re-read a fresh snapshot before submit.
- Workspace create/clone keep their existing target semantics and select the created repository on success.
- Destructive confirmation fields remain explicit exactly where they are today.
- Preview tokens remain required for stage/discard paths.
- A lost follow connection never resubmits the operation.
- Post-write invalidation remains a fallback even when SSE is unavailable.

### Task 1: Lock mutation-model semantics and ownership

**Files:**
- Create: `apps/web/src/lib/workbench/mutation-model.ts`
- Create: `tests/unit/workbench-mutation-model.test.ts`
- Create: `tests/unit/workbench-mutation-boundary.test.ts`

- [ ] Write RED tests for capability availability, unknown repository-creation capability, write refusal messages, and operation-id extraction.
- [ ] Write a RED structural test requiring `+page.svelte` to stop owning mutation-client/follow/write-runner logic.
- [ ] Implement pure helpers and make only model tests GREEN; leave ownership RED until Task 2.
- [ ] Commit `refactor(web): extract workbench mutation model`.

### Task 2: Extract mutation application controller

**Files:**
- Create: `apps/web/src/lib/workbench/mutations.svelte.ts`
- Modify: `apps/web/src/routes/+page.svelte`

- [ ] Move mutation client, busy/message state, capability-derived state, write runner, workspace creation/access, preview tokens, and all semantic handlers into `createWorkbenchMutations`.
- [ ] Keep session negotiation and credential invalidation in the page; inject negotiation/browser-online/token getters into the controller.
- [ ] Replace page mutation implementation with controller aliases/wiring.
- [ ] Run ownership/model units and `pnpm check`.
- [ ] Build and run the full Chromium E2E suite.
- [ ] Run full unit + integration/security suites and `git diff --check`.
- [ ] Commit `refactor(web): extract workbench mutations`.

## Final verification

- [ ] `pnpm check`
- [ ] `pnpm test:unit`
- [ ] `pnpm test:integration`
- [ ] `pnpm exec playwright test --project=chromium`
- [ ] `git diff --check`
