# Native-host evaluation — measured needs, not a runtime spike

> T18 / R12, measured 2026-09-16 on macOS arm64. Decision: continue with the Node sidecar.
> No QuickJS, JavaScriptCore, WASI runtime, or other native VM was built, installed, or run for
> this evaluation. The missing native result is therefore **unverified**, not a zero.

This report closes the review gate described by the v2 design package. It answers whether the
current measurements justify adding a second host, and records the measurements that would be
needed before reopening that decision. It does not add a VM to the product or turn the portable
core smoke into a native-runtime claim.

The evidence inputs are the [machine-readable performance report](../evidence/performance.json),
the [portable-core smoke](../evidence/release-matrix.md), the [cross-platform run notes](../evidence/linux-and-windows.md),
and the current [Xross adapter boundary](../../integrations/xross/README.md).

## measured-node-bottleneck

The actual commands run for this report were:

| Command | Exit status | What it established |
| --- | ---: | --- |
| `pnpm build:release` | 0 | Built the current 0.1.1 API-only CLI bundle at commit `844307b`. |
| `pnpm bench:runtime` in the default sandbox | 1 | The fixture completed, but the temporary loopback listener was refused with `EPERM`; this is not a product measurement. |
| `pnpm bench:runtime` with approved local loopback access | 0 | Completed three lifecycle runs against the full fixture and wrote `performance.json`. |
| `pnpm test:portable` | 0 | Ran the neutral IIFE smoke and its four Vitest cases. |
| `pnpm pack:smoke` with approved local loopback access | 0 | Installed the current tarball in an isolated npm environment and completed all 14 smoke steps. |

The successful benchmark used Node 26.8.2, Git 2.50.1, macOS arm64, one temporary repository with
100,000 linear commits, a 153-path diff fixture, no network, three runs, and concurrency four.
The report uses the median and records each observed range. The most relevant values are:

| Measurement | Result | Scope |
| --- | ---: | --- |
| Cold start to readiness | 0.468 s | CLI process, including the Git feature probe |
| Service RSS before reads | 95 MiB | Refyard service only; no browser or Git child |
| Status throughput | 194.6 reads/s | One service over loopback, concurrency four |
| Service RSS after 100 status reads | 103 MiB | Same service and read batch |
| First history page | 402 ms | 100 commits from the 100,000-commit fixture, bounded response |
| Large-file diff | 118 ms / 1,554,484 bytes | 8,000-line file; time and JSON response payload |
| Long-line diff | 110 ms / 1,442,557 bytes | One 700,000-character line |
| Truncated diff | 133 ms / 1,962,008 bytes | 19,995 of 64,000 patch lines delivered, marked truncated |
| Diff-service RSS after batch | 208 MiB | Service only after large, bounded, long-line and many-file reads |
| Immediate warm large-file diff | 110 ms | Same diff read again |
| Graceful shutdown | 5 ms | SIGTERM with no request in flight |

These numbers demonstrate a measurable Node process cost and a substantial temporary memory
increase while diff responses are parsed. They do **not** demonstrate that the JavaScript runtime
is the bottleneck: the same report measures Git subprocess work, JSON envelopes, and bounded
payloads, but it contains no native comparator. The first actionable diagnosis remains the
workload and retention boundary — history is paged, diffs are bounded, and the 1.5–2.0 MB response
payloads are visible — before paying the complexity cost of another host.

## tested-vm-version

The tested service runtime is Node 26.8.2, the runtime promised by the current `>=22 <27`
published range. The portable check produced a 60,550-byte neutral IIFE and ran 11 planner/parser
checks without Node shims or host globals. That is a host-free JavaScript smoke, not a QuickJS,
JavaScriptCore, WASI, WebView, or native-VM result.

No native VM version was selected or exercised. In particular, this report does not claim that a
particular QuickJS build, JavaScriptCore release, or WASI component can execute the core. The
future test must name the exact engine build, target OS/architecture, bridge implementation, and
compiler/profile before any compatibility statement is made.

## async-and-bytes-conformance

What is verified today is the existing portability boundary: the neutral IIFE executes the core's
planner/parser checks, and the real Node suites exercise byte-framed Git output, large paths,
large lines, bounded diffs, cancellation and error contracts through the host ports. The current
portable command ended with `all 11 planner/parser checks passed`, plus 4 portable Vitest cases.

What is not verified is the same contract inside a native VM: Promise scheduling, cancellation
while a host operation is pending, backpressure for large byte payloads, cleanup after an error,
and differential output against the Node implementation. A native result would need status,
commit, large-byte, cancellation, cleanup, and representative error fixtures over the same
golden inputs. The neutral IIFE cannot substitute for those runs.

## process-cleanup-limitations

The successful benchmark measured a 5 ms SIGTERM-to-exit floor when no request was in flight, and
the tarball smoke completed its installed-package SIGTERM check. Those are useful lifecycle facts,
but neither test is a long-running process-tree measurement. The service's RSS measurements are
explicitly service-only; they do not add child Git/helper RSS, browser tabs, or system memory.

The following remain unverified for a native-host decision:

- child Git/helper process-tree cleanup after cancellation, timeout, and abnormal bridge errors;
- native VM disposal when a request or stream is mid-flight;
- idle CPU, browser-tab increment, and RSS/PSS on a common measurement basis;
- a 24-hour soak or an equivalent long-time workload;
- backpressure and shutdown ordering for a long-lived SSE/MCP stream.

The cross-platform notes do record real Node lifecycle differences: Windows has no POSIX SIGTERM
or process group, so its smoke uses termination appropriate to that platform. That evidence helps
the Node host boundary; it is not evidence for a native VM.

## full-artifact-size

The current API-only release staging was measured after `pnpm build:release`:

- `packages/npm-dist/dist/cli.mjs`: 2,209,211 bytes;
- `packages/npm-dist/dist/build-info.json`: version 0.1.1, engines `>=22 <27`, one entry point;
- `npm pack` package size: 394,396 bytes;
- `npm pack` unpacked size: 2.2 MB, five files;
- `pnpm pack:smoke`: the tarball installed and ran successfully in an isolated environment;
- no web directory is present in the CLI package — the PWA is deployed from `apps/web`.

The 60,550-byte neutral core IIFE is a separate portability artifact, not the size of a native
host. The design package's 512 KiB target and 5 MiB upper bound are review rules for a future
Xross native increment. They are not measured results here: no engine, bridge, native executable,
dependencies, or target assets were assembled, so the native delta is **unverified**.

## same-workload-memory

The Node side of the comparison is real but narrow:

| Workload point | Node service RSS |
| --- | ---: |
| Ready, before reads | 96 MiB |
| After 100 status reads | 104 MiB |
| Diff service ready | 96 MiB |
| Diff service after the batch | 204 MiB |

The last increase is associated with a batch containing a complete approximately 2 MB patch, a
bounded patch, a 700,000-character line, and metadata for 150 changed files. It is not a proof
that Node retained all of that memory permanently; the report is a short repeated run, not a
soak. It is also not comparable to a native number because no native run exists, and because the
measurement is RSS of the service process only. Same-fixture native memory, child-process tree,
idle CPU, and warm/cold lifecycle data are all **unverified**.

## xross-permission-impact

The current adapter was checked against Xross revision
`97925a3f74cf2b95b21389cd7db1c2dcca94d2e7`. Its command is fixed to
`refyard serve --json --no-open --repo <selected-peer-path> --ui-origin <exact-https-origin>`;
it uses an authorized `xross.exec.v1` stream and an authorized loopback forward. It does not
install software, accept shell text, widen a peer grant, or weaken Refyard's Host/Origin checks.
The pure policy and fake lifecycle tests pass, while a real peer launch remains unverified because
this session had no `shell-allow` or `egress-allow` grants and no two-daemon testbed.

A native host would add a different permission and support surface: engine code signing and
updates, bridge ownership, native process termination, and a target-specific Xross profile. None
of those permissions or lifecycle paths may be inferred from the existing adapter. The 512 KiB
target / 5 MiB upper bound must be measured with the same target/profile/features and must include
engine, bridge, core bundle, dependencies, and assets. A QuickJS hello-world binary is not that
measurement.

## decision-and-user-approval

**Decision: stay on the Node sidecar for V1 and defer native-host implementation.** The measured
Node cost is worth tracking, especially the diff-batch RSS, but there is no same-workload native
result showing that replacing the host would improve the product enough to justify a second
runtime, bridge, process model, permission model, and support matrix. The current architecture
already keeps Git Core host-free and preserves a credible future porting boundary.

This task did not receive separate approval to land a native runtime or a product spike. Therefore
the report does not change `packages/git-core`, add QuickJS/JSC/WASI dependencies, or create a
native binary. The explicit Cloudflare direction is satisfied by the separate static-PWA Worker
boundary; it does not turn the native-host review into a product implementation.

Reopen T18 only with explicit approval for a separate, disposable spike and a named target. That
spike must run the same fixtures through the native engine and Node, measure the complete
engine+bridge+core+process+HTTP cost, exercise async/cancel/bytes/cleanup/error behavior, and
repeat the Xross permission and artifact-size review. Until those results exist, the native
runtime result and the Xross real launch remain **unverified**, and the honest release decision is
to continue on Node.
