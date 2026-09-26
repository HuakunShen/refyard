<script lang="ts">
  /** Source-faithful Xross panels; no BackendSession, local path or transport fallback. */
  import { onMount, untrack } from "svelte";
  import { PageContinuation } from "@refyard/git-ui";
  import { provideGitViewI18n } from "@refyard/git-ui/lib/i18n/context.svelte";
  import type { TranslationKey } from "@refyard/git-ui/lib/i18n/types";
  import { parseRefyardId } from "../../../../../../integrations/xross/view-contract/contracts/view-v1/ids.js";
  import type { CommitDetailV1, DiffFileV1, HistoryPageV1, MutationJobV1, MutationPreviewV1, MutationRecoveryV1, RefyardMutationOperationV1, RepositorySummaryV1, StatusEntryV1, SubmoduleSummaryV1, WorktreesSnapshotV1 } from "../../../../../../integrations/xross/view-contract/surfaces/refyard/api.js";
  import { assertCurrentXrossContext, xrossOperationAvailable, type XrossSession } from "../../workbench/xross-session.svelte.js";
  import { createXrossQueries, compareUInt64 } from "../../workbench/xross-queries.svelte.js";
  import { assertMutationJobBinding, canOfferFreshPreview, canPreviewWithRecoveries, recoveryForPreview, previewXrossMutation, submitXrossPreview } from "../../workbench/xross-mutations.svelte.js";
  import { remoteEndpointLabel } from "../../workbench/xross-presentation.js";

  let { session: suppliedSession, onReconnect }: { session: XrossSession; onReconnect: () => Promise<void> } = $props();
  // The route unmounts this view before reconnecting; a mounted view owns one native generation.
  const session = untrack(() => suppliedSession);
  const i18n = provideGitViewI18n(session.context.locale);
  const { t } = i18n;
  const queries = createXrossQueries(session);
  type Scoped = ReturnType<typeof queries.forRepository>;
  type History = ReturnType<Scoped["history"]>;
  type Diff = ReturnType<Scoped["diff"]>;
  let repository = $state<RepositorySummaryV1 | null>(null);
  let scoped = $state<Scoped | null>(null);
  let history = $state<History | null>(null);
  let diff = $state<Diff | null>(null);
  let worktrees = $state<WorktreesSnapshotV1 | null>(null);
  let worktreeProblem = $state<string | null>(null);
  type Panel = "status" | "history" | "refs" | "worktrees" | "stashes" | "submodules" | "diff";
  const panels: readonly Panel[] = ["status", "history", "refs", "worktrees", "stashes", "submodules", "diff"];
  const panelLabels: Readonly<Record<Panel, TranslationKey>> = {
    status: "xross.status.label", history: "xross.history.label", refs: "xross.refs.label",
    worktrees: "xross.worktrees.label", stashes: "xross.stashes.label",
    submodules: "xross.submodules.label", diff: "xross.diff.label",
  };
  const hostKindLabels: Readonly<Record<XrossSession["capabilities"]["host"]["kind"], TranslationKey>> = {
    macos: "xross.host.macos", linux: "xross.host.linux",
    windows: "xross.host.windows", unknown: "xross.host.unknown",
  };
  const recoveryStateLabels: Readonly<Record<MutationRecoveryV1["state"]["kind"], TranslationKey>> = {
    found: "xross.recovery.state.found", unknown: "xross.recovery.state.unknown",
    notAccepted: "xross.recovery.state.notAccepted", reconciled: "xross.recovery.state.reconciled",
    ownerAcceptedUnknown: "xross.recovery.state.ownerAcceptedUnknown",
  };
  const jobStateLabels: Readonly<Record<MutationJobV1["state"], TranslationKey>> = {
    accepted: "xross.job.state.accepted", running: "xross.job.state.running",
    succeeded: "xross.job.state.succeeded", failed: "xross.job.state.failed",
    needsAttention: "xross.job.state.needsAttention", unknown: "xross.job.state.unknown",
    cancelled: "xross.job.state.cancelled",
  };
  const topologyLabels: Readonly<Record<HistoryPageV1["topology"], TranslationKey>> = {
    continuous: "xross.history.topology.continuous", sparse: "xross.history.topology.sparse",
  };
  function topologyLabel(value: HistoryPageV1["topology"] | undefined): string {
    return value === undefined ? t("xross.value.unavailable") : t(topologyLabels[value]);
  }
  const signatureLabels: Readonly<Record<CommitDetailV1["signatureState"], TranslationKey>> = {
    unsigned: "xross.signature.unsigned", valid: "xross.signature.valid",
    invalid: "xross.signature.invalid", unknown: "xross.signature.unknown",
  };
  const submoduleStateLabels: Readonly<Record<SubmoduleSummaryV1["state"], TranslationKey>> = {
    initialized: "xross.submodule.state.initialized", uninitialized: "xross.submodule.state.uninitialized",
    conflicted: "xross.submodule.state.conflicted", unknown: "xross.submodule.state.unknown",
  };
  const changeLabels: Readonly<Record<DiffFileV1["changeKind"], TranslationKey>> = {
    added: "xross.diff.change.added", modified: "xross.diff.change.modified",
    deleted: "xross.diff.change.deleted", renamed: "xross.diff.change.renamed",
    copied: "xross.diff.change.copied", typeChanged: "xross.diff.change.typeChanged",
    unmerged: "xross.diff.change.unmerged", unknown: "xross.diff.change.unknown",
  };
  const patchLabels: Readonly<Record<DiffFileV1["patch"]["kind"], TranslationKey>> = {
    text: "xross.diff.patch.text", binary: "xross.diff.patch.binary",
    oversize: "xross.diff.patch.oversize", unavailable: "xross.diff.patch.unavailable",
    submodule: "xross.diff.patch.submodule",
  };
  const reasonLabels: Readonly<Record<"byteLimit" | "lineLimit" | "pathUnrepresentable" | "objectMissing" | "unsupported", TranslationKey>> = {
    byteLimit: "xross.diff.reason.byteLimit", lineLimit: "xross.diff.reason.lineLimit",
    pathUnrepresentable: "xross.diff.reason.pathUnrepresentable", objectMissing: "xross.diff.reason.objectMissing",
    unsupported: "xross.diff.reason.unsupported",
  };
  let panel = $state<Panel>("status");
  let recoveries = $state<readonly MutationRecoveryV1[]>([]);
  let recoveryCursor = $state<string | null>(null);
  let recoverySnapshot = $state<string | null>(null);
  let recoveryProblem = $state<string | null>(null);
  let recoveryLoading = $state(false);
  let recoveryReady = $state(false);
  let unresolvedSubmission = $state(false);
  let pendingRecoveryId = $state<MutationPreviewV1["recoveryId"] | null>(null);
  let releasedRecoveryId = $state<MutationRecoveryV1["recoveryId"] | null>(null);
  let commitMessage = $state("");
  let historyMessage = $state("");
  let historyAuthor = $state("");
  let firstParentOnly = $state(false);
  let commitDetail = $state<CommitDetailV1 | null>(null);
  let preview = $state<MutationPreviewV1 | null>(null);
  let mutationProblem = $state<string | null>(null);
  let approvalDecision = $state<"denied" | "cancelled" | null>(null);
  let jobs = $state<readonly MutationJobV1[]>([]);
  const watchedJobs = new Set<string>();
  let alive = true;
  let reconnecting = false;

  const recoveryBlocksWrites = $derived(!canPreviewWithRecoveries({
    ready: recoveryReady, loading: recoveryLoading, problem: recoveryProblem,
    nextCursor: recoveryCursor, unresolvedSubmission, recoveries, releasedRecoveryId,
  }));

  $effect(() => {
    const problems = [queries.roots.current().problem, queries.repositories.current().problem,
      scoped?.status.current().problem, scoped?.refs.current().problem,
      scoped?.stashes.current().problem, scoped?.submodules.current().problem,
      history?.current().problem, diff?.current().problem];
    if (!reconnecting && problems.includes("StaleGeneration")) {
      reconnecting = true;
      void onReconnect();
    }
  });

  function problemCode(error: unknown): string | null {
    return typeof error === "object" && error !== null && typeof Reflect.get(error, "code") === "string"
      ? String(Reflect.get(error, "code")) : null;
  }

  async function loadRecoveries(continueCursor = false): Promise<void> {
    if (recoveryLoading) return;
    recoveryLoading = true;
    recoveryReady = false;
    recoveryProblem = null;
    try {
      const cursor = continueCursor && recoveryCursor !== null ? parseRefyardId("cur", recoveryCursor) : null;
      if (continueCursor && cursor === null) throw new Error("invalid recovery cursor");
      let page = await queries.current(() => session.host.listMutationRecoveries({ query: { limit: 100, ...(cursor === null ? {} : { cursor }) } }));
      if (continueCursor && recoverySnapshot !== page.snapshotId) {
        recoveries = [];
        recoveryCursor = null;
        recoverySnapshot = null;
        page = await queries.current(() => session.host.listMutationRecoveries({ query: { limit: 100 } }));
        continueCursor = false;
      }
      recoveries = continueCursor ? [...recoveries, ...page.items] : page.items;
      recoveryCursor = page.nextCursor;
      recoverySnapshot = page.snapshotId;
      if (releasedRecoveryId !== null && !recoveries.some((row) => row.recoveryId === releasedRecoveryId && canOfferFreshPreview(row))) {
        releasedRecoveryId = null;
      }
      if (pendingRecoveryId !== null && recoveryForPreview({ recoveryId: pendingRecoveryId }, recoveries) !== undefined) {
        // A row may be found but blocked; only the native fence can offer a new preview.
        unresolvedSubmission = false;
      }
      for (const row of page.items) if (row.state.kind === "found") followJob(row.state.job);
      recoveryReady = true;
    } catch (error) {
      recoveryProblem = problemCode(error) === "RecoveryUnavailable" ? t("xross.recovery.unavailable") : String(error);
      if (problemCode(error) === "StaleGeneration" && !reconnecting) {
        reconnecting = true;
        await onReconnect();
      }
    } finally {
      recoveryLoading = false;
    }
  }

  function adoptJob(job: MutationJobV1): void {
    const previous = jobs.find((item) => item.jobId === job.jobId);
    if (previous !== undefined && compareUInt64(previous.sequence, job.sequence) >= 0) return;
    jobs = [...jobs.filter((item) => item.jobId !== job.jobId), job];
  }

  function followJob(job: MutationJobV1): void {
    adoptJob(job);
    if (watchedJobs.has(job.jobId)) return;
    watchedJobs.add(job.jobId);
    void (async () => {
      try {
        const current = assertMutationJobBinding(job.jobId, await session.host.getMutationJob({ jobId: job.jobId }));
        if (alive) adoptJob(current);
        for await (const event of session.host.watchMutation({ jobId: job.jobId, sinceSequence: current.sequence })) {
          if (!alive) break;
          if (event.kind === "event") adoptJob(assertMutationJobBinding(job.jobId, event.value));
          else {
            adoptJob(assertMutationJobBinding(job.jobId, await session.host.getMutationJob({ jobId: job.jobId })));
            if (event.kind === "terminal") break;
          }
        }
      } catch (error) {
        if (alive) mutationProblem = String(error);
      } finally {
        watchedJobs.delete(job.jobId);
      }
    })();
  }

  async function loadPanel(): Promise<void> {
    if (scoped === null) return;
    switch (panel) {
      case "status": await scoped.status.load(); break;
      case "history": await history?.load(); break;
      case "refs": await scoped.refs.load(); break;
      case "worktrees": {
        try { worktrees = await scoped.worktrees(); worktreeProblem = null; }
        catch (error) { worktreeProblem = String(error); }
        break;
      }
      case "stashes": await scoped.stashes.load(); break;
      case "submodules": await scoped.submodules.load(); break;
      case "diff": await diff?.load(); break;
    }
  }

  function resetScopedReads(): void {
    scoped?.status.reset();
    scoped?.refs.reset();
    scoped?.stashes.reset();
    scoped?.submodules.reset();
    history?.reset();
    diff?.reset();
    worktrees = null;
    commitDetail = null;
    preview = null;
  }

  async function selectRepository(item: RepositorySummaryV1): Promise<void> {
    repository = item;
    scoped = queries.forRepository(item.repositoryId, item.primaryWorktreeId);
    history = scoped.history();
    diff = scoped.diff({ kind: "unstaged", worktreeId: item.primaryWorktreeId, limit: 100 });
    worktrees = null;
    preview = null;
    await loadPanel();
    if (!session.capabilities.reads.includes("events")) return;
    void (async () => {
      let lastSequence: string | null = null;
      try {
        for await (const event of session.host.watchRepository({ repositoryId: item.repositoryId })) {
          if (!alive || repository?.repositoryId !== item.repositoryId) break;
          if (event.kind === "event" || event.kind === "terminal") {
            if (lastSequence !== null && compareUInt64(event.sequence, lastSequence) <= 0) continue;
            lastSequence = event.sequence;
          }
          if (event.kind === "gap" || event.kind === "event" || event.kind === "terminal") {
            resetScopedReads();
            await loadPanel();
          }
          if (event.kind === "terminal") break;
        }
      } catch (error) {
        if (alive && problemCode(error) === "StaleGeneration" && !reconnecting) {
          reconnecting = true;
          await onReconnect();
        } else if (alive) worktreeProblem = String(error);
      }
    })();
  }

  async function previewCommit(): Promise<void> {
    if (repository === null || scoped === null || recoveryBlocksWrites) return;
    const snapshotId = scoped.status.current().source?.snapshotId;
    if (snapshotId === undefined) return;
    preview = null;
    mutationProblem = null;
    try {
      preview = await previewXrossMutation(session, {
        target: { kind: "worktree", repositoryId: repository.repositoryId,
          worktreeId: repository.primaryWorktreeId, expectedSnapshotId: snapshotId },
        operation: { kind: "commit", message: commitMessage },
      });
    } catch (error) { mutationProblem = String(error); }
  }

  async function previewStatusAction(entry: StatusEntryV1, kind: "stagePaths" | "unstagePaths"): Promise<void> {
    const selected = repository;
    const currentScoped = scoped;
    if (selected === null || currentScoped === null || recoveryBlocksWrites) return;
    const snapshotId = currentScoped.status.current().source?.snapshotId;
    if (snapshotId === undefined || !xrossOperationAvailable(session, kind, "worktree")) return;
    preview = null;
    mutationProblem = null;
    try {
      let operation: Extract<RefyardMutationOperationV1, { readonly kind: "stagePaths" | "unstagePaths" }>;
      if (kind === "stagePaths") {
        const previews = await queries.current(() => session.host.getPathPreviews({
          repositoryId: selected.repositoryId, worktreeId: selected.primaryWorktreeId,
          expectedSnapshotId: snapshotId, pathIds: [entry.pathId],
        }));
        if (previews.snapshotId !== snapshotId) throw new Error("path preview snapshot changed");
        const path = previews.tokens.find((item) => item.pathId === entry.pathId);
        const token = path === undefined ? null : parseRefyardId("pt", path.previewToken);
        if (path === undefined || token === null || path.contentKind === "unrepresentable") {
          throw new Error("target did not provide a usable path preview");
        }
        operation = { kind: "stagePaths", pathIds: [entry.pathId], previewTokens: [token] };
      } else {
        operation = { kind: "unstagePaths", pathIds: [entry.pathId] };
      }
      preview = await previewXrossMutation(session, { target: { kind: "worktree",
        repositoryId: selected.repositoryId, worktreeId: selected.primaryWorktreeId,
        expectedSnapshotId: snapshotId }, operation });
    } catch (error) { mutationProblem = String(error); }
  }

  async function applyHistoryFilter(): Promise<void> {
    if (scoped === null) return;
    commitDetail = null;
    history = scoped.history({
      ...(historyMessage.length === 0 ? {} : { message: historyMessage }),
      ...(historyAuthor.length === 0 ? {} : { author: historyAuthor }),
      firstParentOnly,
    });
    await history.load();
  }

  async function selectCommitDetail(oid: string): Promise<void> {
    const selected = repository;
    if (selected === null) return;
    try {
      const page = await queries.current(() => session.host.historyPage({
        repositoryId: selected.repositoryId,
        query: { detailOid: oid, worktreeId: selected.primaryWorktreeId, limit: 1 },
      }));
      commitDetail = page.detail;
    } catch (error) { mutationProblem = String(error); }
  }

  async function requestNativeSubmission(): Promise<void> {
    if (preview === null || recoveryBlocksWrites) return;
    try {
      assertCurrentXrossContext(session.context, await session.host.context());
    } catch {
      await onReconnect();
      return;
    }
    const currentPreview = preview;
    preview = null;
    mutationProblem = null;
    approvalDecision = null;
    try {
      const result = await submitXrossPreview(session.host, currentPreview.previewId);
      if (result.decision === "approved") {
        assertCurrentXrossContext(session.context, await session.host.context());
        followJob(result.outcome);
      }
      else approvalDecision = result.decision;
      await loadRecoveries();
    } catch (error) {
      unresolvedSubmission = true;
      pendingRecoveryId = currentPreview.recoveryId;
      mutationProblem = `${t("xross.mutation.unknown")} ${String(error)}`;
      await loadRecoveries();
    }
  }

  onMount(() => {
    void Promise.all([queries.roots.load(), queries.repositories.load(), loadRecoveries()]);
    const resume = () => {
      void (async () => {
        try {
          await queries.current(() => session.host.context());
          await loadRecoveries();
          await loadPanel();
        } catch { await onReconnect(); }
      })();
    };
    window.addEventListener("pageshow", resume);
    window.addEventListener("focus", resume);
    return () => {
      alive = false;
      window.removeEventListener("pageshow", resume);
      window.removeEventListener("focus", resume);
    };
  });
</script>

<main class="mx-auto max-w-7xl space-y-6 p-4 md:p-6">
  <header class="border-b pb-4">
    <h1 class="text-2xl font-semibold">{t("xross.title.label")}</h1>
    <p class="text-sm text-muted-foreground">{t("xross.target.label")}: {session.context.targetDisplayLabel} · {t("xross.field.host")}: {t(hostKindLabels[session.capabilities.host.kind])}</p>
  </header>

  <div class="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
    <aside class="space-y-5">
      <section aria-labelledby="xross-roots-heading">
        <h2 id="xross-roots-heading" class="font-semibold">{t("xross.workspace.label")}</h2>
        {#each queries.roots.current().items as root (root.workspaceRootId)}
          <p class="text-sm">{root.displayLabel}</p>
        {/each}
        <PageContinuation nextCursor={queries.roots.current().nextCursor} truncated={queries.roots.current().truncated} loading={queries.roots.current().loading} error={queries.roots.current().problem} onContinue={queries.roots.continue} />
      </section>
      <section aria-labelledby="xross-repos-heading">
        <h2 id="xross-repos-heading" class="font-semibold">{t("xross.repository.label")}</h2>
        {#if queries.repositories.current().items.length === 0 && !queries.repositories.current().loading && queries.repositories.current().problem === null}
          <p class="text-sm text-muted-foreground">{t("xross.repository.empty")}</p>
        {/if}
        {#each queries.repositories.current().items as item (item.repositoryId)}
          <button type="button" class="block w-full rounded px-2 py-1 text-left hover:bg-muted focus-visible:outline-2" aria-current={repository?.repositoryId === item.repositoryId ? "true" : undefined} onclick={() => void selectRepository(item)}>{item.displayName}</button>
        {/each}
        <PageContinuation nextCursor={queries.repositories.current().nextCursor} truncated={queries.repositories.current().truncated} loading={queries.repositories.current().loading} error={queries.repositories.current().problem} onContinue={queries.repositories.continue} />
      </section>
    </aside>

    <div class="min-w-0 space-y-5">
      {#if repository !== null && scoped !== null}
        <nav class="flex flex-wrap gap-2" aria-label={t("xross.repository.label")}>
          {#each panels as name}
            <button type="button" class:font-bold={panel === name} class="rounded border px-2 py-1 text-sm" onclick={() => { panel = name; void loadPanel(); }}>{t(panelLabels[name])}</button>
          {/each}
        </nav>
        {#if panel === "status"}
          {@const statusPage = scoped.status.current()}
          <section aria-labelledby="xross-status-heading">
            <h2 id="xross-status-heading" class="font-semibold">{t("xross.status.label")}</h2>
            {#if statusPage.source !== undefined}<p class="text-xs text-muted-foreground">{i18n.paths(statusPage.source.entryCount)}</p>{/if}
            {#each scoped.status.current().items as entry (entry.pathId)}
              <div class="border-b py-2 text-sm"><span class="font-mono">{entry.indexStatus}{entry.worktreeStatus}</span> {entry.displayPath}
                {#if entry.originalDisplayPath !== null}<span> ← {entry.originalDisplayPath}</span>{/if}
                {#if entry.headOid !== null}<small> · {t("xross.status.headOid")}: <code>{entry.headOid}</code></small>{/if}
                {#if entry.indexOid !== null}<small> · {t("xross.status.indexOid")}: <code>{entry.indexOid}</code></small>{/if}
                {#if entry.unmergedStages !== null}<small> · {t("xross.status.unmergedStages")}: {entry.unmergedStages.map((stage) => `${stage.stage}:${stage.oid ?? t("xross.value.unavailable")}`).join(", ")}</small>{/if}
                {#if entry.submodule !== null}<small> · {t("xross.status.submoduleCommit")}: {t(entry.submodule.commitChanged ? "xross.value.yes" : "xross.value.no")}, {t("xross.status.submoduleModified")}: {t(entry.submodule.modified ? "xross.value.yes" : "xross.value.no")}, {t("xross.status.submoduleUntracked")}: {t(entry.submodule.untracked ? "xross.value.yes" : "xross.value.no")}</small>{/if}
                {#if xrossOperationAvailable(session, "stagePaths", "worktree")}
                  <button type="button" class="ml-2 rounded border px-2" disabled={recoveryBlocksWrites} onclick={() => void previewStatusAction(entry, "stagePaths")}>{t("xross.mutation.stage")}</button>
                {/if}
                {#if xrossOperationAvailable(session, "unstagePaths", "worktree")}
                  <button type="button" class="ml-2 rounded border px-2" disabled={recoveryBlocksWrites} onclick={() => void previewStatusAction(entry, "unstagePaths")}>{t("xross.mutation.unstage")}</button>
                {/if}
              </div>
            {/each}
            <PageContinuation nextCursor={scoped.status.current().nextCursor} truncated={scoped.status.current().truncated} loading={scoped.status.current().loading} error={scoped.status.current().problem} onContinue={scoped.status.continue} />
            {#if session.capabilities.operations.some((item) => item.operationKind === "commit" && item.targets.includes("worktree"))}
              <div class="mt-4 space-y-2 border-t pt-4">
                <label class="block text-sm" for="xross-commit-message">{t("xross.mutation.commitMessage")}</label>
                <textarea id="xross-commit-message" bind:value={commitMessage} class="w-full rounded border p-2"></textarea>
                <button type="button" class="rounded border px-3 py-2" disabled={recoveryBlocksWrites || commitMessage.length === 0 || scoped.status.current().source === undefined} onclick={() => void previewCommit()}>{t("xross.mutation.preview")}</button>
                {#if preview !== null}<p class="text-sm">{preview.resourceLabel} · {t("xross.field.operation")}: <code>{preview.operationKind}</code> · {t("xross.field.summary")}: <code>{preview.summaryKey}</code></p><button type="button" class="rounded border px-3 py-2" disabled={recoveryBlocksWrites} onclick={() => void requestNativeSubmission()}>{t("xross.mutation.nativeApproval")}</button>{/if}
                {#if approvalDecision !== null}<p role="status">{t(approvalDecision === "denied" ? "xross.mutation.denied" : "xross.mutation.cancelled")}</p>{/if}
                {#if mutationProblem !== null}<p role="alert">{mutationProblem}</p>{/if}
              </div>
            {/if}
          </section>
        {:else if panel === "history" && history !== null}
          <section aria-labelledby="xross-history-heading"><h2 id="xross-history-heading" class="font-semibold">{t("xross.history.label")}</h2>
            <form class="flex flex-wrap gap-2 py-2" onsubmit={(event) => { event.preventDefault(); void applyHistoryFilter(); }}>
              <label>{t("xross.history.message")} <input type="search" bind:value={historyMessage} class="rounded border p-1" /></label>
              <label>{t("xross.history.author")} <input type="search" bind:value={historyAuthor} class="rounded border p-1" /></label>
              <label><input type="checkbox" bind:checked={firstParentOnly} /> {t("xross.history.firstParent")}</label>
              <button type="submit" class="rounded border px-2">{t("xross.history.filter")}</button>
            </form>
            <p class="text-sm text-muted-foreground">{t("xross.field.topology")}: {topologyLabel(history.current().source?.topology)}</p>
            {#each history.current().items as commit (commit.oid)}<button type="button" class="block w-full border-b py-2 text-left text-sm" onclick={() => void selectCommitDetail(commit.oid)}><span class="font-mono">{commit.oid.slice(0, 8)}</span> {commit.subject} · {commit.authorName} · {i18n.absoluteTime(commit.committedAtUnixMs)}</button>{/each}
            {#if commitDetail !== null}<article class="rounded border p-3 text-sm"><h3>{commitDetail.subject}</h3><p>{t("xross.field.signature")}: {t(signatureLabels[commitDetail.signatureState])}</p><pre class="whitespace-pre-wrap">{commitDetail.body}</pre></article>{/if}
            <PageContinuation nextCursor={history.current().nextCursor} truncated={history.current().truncated} loading={history.current().loading} error={history.current().problem} onContinue={history.continue} />
          </section>
        {:else if panel === "refs"}
          <section aria-labelledby="xross-refs-heading"><h2 id="xross-refs-heading" class="font-semibold">{t("xross.refs.label")}</h2>
            {#each scoped.refs.current().items as ref, index (index)}<div class="border-b py-2 text-sm">
              {#if ref.kind === "remote"}<span>{ref.name}</span> — {remoteEndpointLabel(ref.fetchEndpoint, i18n.locale)}
                {#if ref.pushEndpoint !== null}<span> · {remoteEndpointLabel(ref.pushEndpoint, i18n.locale)}</span>{/if}
              {:else}<span>{ref.kind === "other" ? ref.fullName : ref.name}</span> <span class="font-mono">{ref.oid.slice(0, 8)}</span>{/if}
            </div>{/each}
            <PageContinuation nextCursor={scoped.refs.current().nextCursor} truncated={scoped.refs.current().truncated} loading={scoped.refs.current().loading} error={scoped.refs.current().problem} onContinue={scoped.refs.continue} />
          </section>
        {:else if panel === "worktrees"}
          <section aria-labelledby="xross-worktrees-heading"><h2 id="xross-worktrees-heading" class="font-semibold">{t("xross.worktrees.label")}</h2>
            {#if worktreeProblem !== null}<p role="alert">{worktreeProblem}</p>{/if}
            {#each worktrees?.worktrees ?? [] as tree (tree.worktreeId)}<div class="border-b py-2 text-sm">{tree.rootRelativeDisplayPath} · {i18n.head(tree.head)} · {tree.locked ? tree.lockReason ?? t("xross.worktree.locked") : ""}</div>{/each}
          </section>
        {:else if panel === "stashes"}
          <section aria-labelledby="xross-stashes-heading"><h2 id="xross-stashes-heading" class="font-semibold">{t("xross.stashes.label")}</h2>
            {#each scoped.stashes.current().items as stash (stash.locator)}<div class="border-b py-2 text-sm">{stash.locator} · {stash.message} · {i18n.absoluteTime(stash.createdAtUnixMs)}</div>{/each}
            <PageContinuation nextCursor={scoped.stashes.current().nextCursor} truncated={scoped.stashes.current().truncated} loading={scoped.stashes.current().loading} error={scoped.stashes.current().problem} onContinue={scoped.stashes.continue} />
          </section>
        {:else if panel === "submodules"}
          <section aria-labelledby="xross-submodules-heading"><h2 id="xross-submodules-heading" class="font-semibold">{t("xross.submodules.label")}</h2>
            {#each scoped.submodules.current().items as submodule (submodule.pathId)}<div class="border-b py-2 text-sm">
              <strong>{submodule.displayPath}</strong> · {t(submoduleStateLabels[submodule.state])} · {remoteEndpointLabel(submodule.urlEndpoint, i18n.locale)}
              <p>{t("xross.submodule.recordedOid")}: {submodule.recordedOid ?? t("xross.value.unavailable")} · {t("xross.submodule.indexOid")}: {submodule.indexOid ?? t("xross.value.unavailable")} · {t("xross.submodule.actualOid")}: {submodule.actualOid ?? t("xross.value.unavailable")}</p>
              {#if submodule.branchDisplay !== null}<p>{t("xross.submodule.branch")}: {submodule.branchDisplay}</p>{/if}
            </div>{/each}
            <PageContinuation nextCursor={scoped.submodules.current().nextCursor} truncated={scoped.submodules.current().truncated} loading={scoped.submodules.current().loading} error={scoped.submodules.current().problem} onContinue={scoped.submodules.continue} />
          </section>
        {:else if panel === "diff" && diff !== null}
          <section aria-labelledby="xross-diff-heading"><h2 id="xross-diff-heading" class="font-semibold">{t("xross.diff.label")}</h2>
            {#each diff.current().items as file (file.pathId)}<article class="border-b py-3 text-sm"><h3 class="font-mono">{file.displayPath}</h3><p>{t("xross.field.change")}: {t(changeLabels[file.changeKind])} · {t("xross.field.patch")}: {t(patchLabels[file.patch.kind])}</p>
              {#if file.oldDisplayPath !== null}<p>{t("xross.diff.oldPath")}: {file.oldDisplayPath}</p>{/if}
              {#if file.oldMode !== null}<p>{t("xross.diff.oldMode")}: {file.oldMode}</p>{/if}
              {#if file.newMode !== null}<p>{t("xross.diff.newMode")}: {file.newMode}</p>{/if}
              {#if file.patch.kind === "text"}
                {#if file.patch.synthesized}<p>{t("xross.diff.synthesized")}</p>{/if}
                {#each file.patch.hunks as hunk}<pre class="overflow-x-auto">{hunk.header}
{#each hunk.lines as line}{line.oldLine ?? " "} {line.newLine ?? " "} {line.kind === "addition" ? "+" : line.kind === "deletion" ? "-" : " "}{line.text}
{/each}</pre>{/each}
              {:else if file.patch.kind === "oversize" || file.patch.kind === "unavailable"}<p>{t("xross.diff.reason")}: {t(reasonLabels[file.patch.reason])}</p>
              {:else if file.patch.kind === "submodule"}<p>{file.patch.oldOid ?? t("xross.value.unavailable")} → {file.patch.newOid ?? t("xross.value.unavailable")}</p>{/if}
            </article>{/each}
            <PageContinuation nextCursor={diff.current().nextCursor} truncated={diff.current().truncated} loading={diff.current().loading} error={diff.current().problem} onContinue={diff.continue} />
          </section>
        {/if}
      {/if}
    </div>
  </div>

  <section aria-labelledby="xross-recovery-heading" class="border-t pt-5">
    <h2 id="xross-recovery-heading" class="font-semibold">{t("xross.recovery.label")}</h2>
    {#if recoveryProblem !== null}<p role="alert">{recoveryProblem}</p>{/if}
    {#each recoveries as row (row.recoveryId)}
      <div class="border-b py-2 text-sm"><strong>{row.resourceLabel}</strong> · {t("xross.field.operation")}: <code>{row.operationKind}</code> · {t("xross.field.state")}: {t(recoveryStateLabels[row.state.kind])}
        {#if canOfferFreshPreview(row) && (pendingRecoveryId === null || pendingRecoveryId === row.recoveryId)}<button type="button" class="ml-2 rounded border px-2" onclick={() => { releasedRecoveryId = row.recoveryId; preview = null; }}>{t("xross.recovery.freshPreview")}</button>{/if}
        {#if row.state.kind === "unknown"}<p role="alert">{t("xross.recovery.unknown")}</p>
        {:else if row.state.kind === "ownerAcceptedUnknown"}<p>{t("xross.recovery.ownerAcceptedUnknown")}</p>
        {:else if row.state.kind === "reconciled"}<p>{t("xross.recovery.reconciled")}</p>
        {:else if row.state.kind === "notAccepted"}<p>{t("xross.recovery.notAccepted")}</p>{/if}
      </div>
    {/each}
    <PageContinuation nextCursor={recoveryCursor} truncated={recoveryCursor !== null} loading={recoveryLoading} error={recoveryProblem} onContinue={() => loadRecoveries(true)} />
    {#each jobs as job (job.jobId)}<p class="text-sm"><code>{job.jobId}</code> · {t("xross.field.state")}: {t(jobStateLabels[job.state])} · <code>{job.sequence}</code></p>{/each}
  </section>
</main>
