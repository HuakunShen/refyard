# Hono HTTP Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Remove the unreachable legacy GitService dispatcher from `server.ts` so Hono is the single API/security application path while preserving the Node listener's static-asset and lifecycle responsibilities.

**Architecture:** `createHonoHttpApp()` continues to own health, session exchange, authenticated GitService routes, SSE, OpenAPI, Scalar and MCP. `startHttpHost()` owns Node binding, origin-policy initialization, in-flight shutdown accounting and static SPA delivery for non-Hono paths. No public URL, response schema, auth rule or hosted/local behavior changes.

**Tech Stack:** Node HTTP, Hono, TypeScript, Vitest integration tests.

**Spec:** `docs/product/git-client-direction.md`

## Global constraints

- API/discovery paths still enter Hono before the static handler.
- Static requests still enforce request-target size, exact Host/Origin policy and existing JSON refusals.
- Unknown `/api/*` paths never fall through to the SPA.
- No auth, scope, query or mutation semantics change in this task.
- Do not move GitService meaning into the Node listener.

### Task 1: Lock the ownership boundary

**Files:**

- Create: `tests/unit/http-application-boundary.test.ts`

- [x] Add a source-level architecture test proving `server.ts` delegates API ownership to `createHonoHttpApp` and does not own route tables, session schemas, request-body validation or repository scope checks.
- [x] Run the focused test and prove it fails against the current shadow implementation.

### Task 2: Remove the shadow dispatcher

**Files:**

- Modify: `packages/host-node/src/http/server.ts`

- [x] Delete legacy health, SSE, session exchange and `/api/*` dispatch from the static path.
- [x] Remove the now-unused route/contract/parser/scope imports and helpers.
- [x] Keep a small static request handler with URL-size check, Host/Origin policy, hosted OPTIONS compatibility, asset serving and JSON not-found/refusal behavior.
- [x] Update the module header to describe the real ownership boundary.
- [x] Run `pnpm check` and the focused architecture test.

### Task 3: Prove behavioral parity

- [x] Run `pnpm exec vitest run tests/integration/http.test.ts tests/integration/auth.test.ts tests/integration/hono.test.ts`.
- [x] Run `pnpm test:unit` and `pnpm test:integration`.
- [x] Run `git diff --check`.
- [x] Commit `refactor(host-node): converge HTTP routing on Hono`.
