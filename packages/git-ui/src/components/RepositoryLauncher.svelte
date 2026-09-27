<script lang="ts">
  /** GitKraken-style repository entry screen for local Open, Recent, Clone and Create. */
  import {
    Clock3,
    FolderOpen,
    GitBranchPlus,
    ChevronLeft,
    MonitorSmartphone,
    Search,
    UploadCloud,
  } from "@lucide/svelte";
  import type {
    ExecutionTargetSummary,
    FilesystemEntriesResponse,
  } from "@refyard/git-contract";
  import { Badge } from "./ui/badge/index.js";
  import { Button } from "./ui/button/index.js";
  import { Input } from "./ui/input/index.js";
  import * as Dialog from "./ui/dialog/index.js";
  import RepositoryPanel, {
    type CloneRequest,
    type InitRequest,
    type WorkspaceRoot,
  } from "./RepositoryPanel.svelte";
  import ExecutionTargetPicker from "./ExecutionTargetPicker.svelte";
  import { cn } from "../lib/utils.js";
  import {
    executionLocationKey,
    loadTargetOptions,
    supportsSshTargets,
    type ExecutionTargetSelection,
    type TargetDiscoveryPort,
    type TargetOptionsLoad,
  } from "../lib/execution-targets.js";
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";

  export interface RecentRepository {
    readonly repositoryId: string;
    readonly displayName: string;
    readonly displayPath: string;
    readonly lastOpenedAt: string;
    readonly available: boolean;
    /**
     * The target this entry was opened on, when one was chosen. It is what tells the
     * same path on two machines apart, and it is part of the list key: two entries that
     * share a repository id must still be two rows.
     */
    readonly target?: ExecutionTargetSelection | null;
  }

  interface Props {
    recent: readonly RecentRepository[];
    roots: readonly WorkspaceRoot[];
    repositoryCreationAvailable:
      { readonly init: boolean; readonly clone: boolean } | "unknown";
    disabled?: boolean;
    busy?: boolean;
    message?: string | null;
    onOpen: (path: string) => void;
    onBrowse: (path: string) => Promise<FilesystemEntriesResponse>;
    onRecent: (entry: RecentRepository) => void;
    onInit: (request: InitRequest) => void;
    onClone: (request: CloneRequest) => void;
    /**
     * The app's injected host service — only its two discovery reads are used, so a
     * caller without execution-target support simply omits it and the launcher keeps
     * the local-only shape it had. Passing it does not let the launcher connect to
     * anything: it can only read capabilities and the SSH host list.
     */
    hostService?: TargetDiscoveryPort | null;
    /** Controlled selection; omit to let the launcher keep the choice itself. */
    selectedTarget?: ExecutionTargetSelection | null;
    onSelectTarget?: (target: ExecutionTargetSelection) => void;
    /**
     * What the host reports about the chosen target, once one exists. Its
     * `remotePathBrowse` is the host's own answer about listing directories on that
     * machine, which is what the Browse control is disabled with — never replaced by a
     * listing of this machine's filesystem.
     */
    selectedTargetSummary?: ExecutionTargetSummary | null;
    /** Which step of creating/opening is running, as a sentence for the user. */
    targetProgress?: string | null;
    /** The host's own words when a step of the remote open failed. */
    targetError?: string | null;
    /**
     * Opens the OS folder picker and answers the one full path chosen, or `null`
     * for a cancelled dialog. The button that calls it is offered only when the
     * host's own capabilities say the picker exists — the flag, not the presence of
     * this callback, is what gates the affordance.
     */
    onPickLocalFolder?: () => Promise<string | null>;
    /** True while an OS drag with real paths is over the window: show the overlay. */
    dropPathsActive?: boolean;
  }

  let {
    recent,
    roots,
    repositoryCreationAvailable,
    disabled = false,
    busy = false,
    message = null,
    onOpen,
    onBrowse,
    onRecent,
    onInit,
    onClone,
    hostService = null,
    selectedTarget = undefined,
    onSelectTarget = undefined,
    selectedTargetSummary = null,
    targetProgress = null,
    targetError = null,
    onPickLocalFolder = undefined,
    dropPathsActive = false,
  }: Props = $props();
  const i18n = useGitViewI18n();
  const { t } = i18n;

  let mode = $state<"open" | "create">("open");
  let path = $state("");
  let query = $state("");
  let pickerOpen = $state(false);
  let pickerPath = $state("~");
  let pickerData = $state<FilesystemEntriesResponse | null>(null);
  let pickerBusy = $state(false);
  let pickerError = $state<string | null>(null);
  let targetPickerOpen = $state(false);
  let nativePickerBusy = $state(false);
  let nativePickerError = $state<string | null>(null);
  let targetLoad = $state<TargetOptionsLoad | null>(null);
  let localTargetChoice = $state<ExecutionTargetSelection | null>(null);

  const chosenTarget = $derived(
    selectedTarget === undefined ? localTargetChoice : selectedTarget,
  );
  const chosenTargetLabel = $derived(
    chosenTarget === null || chosenTarget.kind === "local"
      ? t("target.thisMachine")
      : chosenTarget.label,
  );
  const localTargetChosen = $derived(
    chosenTarget === null || chosenTarget.kind === "local",
  );
  /**
   * The path field means different things per target, and the difference is not
   * cosmetic: this machine's path is resolved and browsed by the host here, a remote
   * path belongs to a machine this one cannot list. The two never share a Browse.
   */
  const remoteTargetChosen = $derived(!localTargetChosen);
  const pathFieldLabel = $derived(
    t(remoteTargetChosen ? "launcher.remotePath" : "launcher.localPath"),
  );
  const pathFieldPlaceholder = $derived(
    remoteTargetChosen
      ? "/absolute/path/on/that/machine"
      : "/absolute/path/to/repository",
  );
  /**
   * Why Browse cannot be used for this target. The host's own answer is quoted when it
   * has one; otherwise the limit is this build's, and it says so instead of implying
   * the host refused.
   */
  const remoteBrowseReason = $derived.by(() => {
    if (!remoteTargetChosen) return null;
    if (
      selectedTargetSummary !== null &&
      !selectedTargetSummary.remotePathBrowse
    ) {
      return t("launcher.remoteBrowseUnavailable").replace("{target}", () => chosenTargetLabel);
    }
    return t("launcher.remoteBrowseUnsupported").replace("{target}", () => chosenTargetLabel);
  });
  const openPending = $derived(remoteTargetChosen && targetProgress !== null);
  /**
   * The capability answer decides whether the location control exists at all; a read
   * that failed hides it rather than offering a control that cannot work. The picker
   * re-reads this when it opens, so the answer stays the host's, not a cached claim.
   */
  const targetControlAvailable = $derived(
    targetLoad !== null &&
      targetLoad.capabilities !== null &&
      supportsSshTargets(targetLoad.capabilities),
  );

  $effect(() => {
    const host = hostService;
    if (host === null) {
      targetLoad = null;
      return;
    }
    let cancelled = false;
    void loadTargetOptions(host).then((load) => {
      if (!cancelled) targetLoad = load;
    });
    return () => {
      cancelled = true;
    };
  });

  /**
   * The picker's own read, performed when it opens: capabilities and the SSH host
   * list, nothing else. It is the same function the control's gate uses, so the two
   * cannot drift apart.
   */
  async function refreshTargetOptions(): Promise<TargetOptionsLoad> {
    const host = hostService;
    if (host === null) {
      return {
        kind: "unavailable",
        capabilities: null,
        message: t("launcher.noHostConnection"),
      };
    }
    const load = await loadTargetOptions(host);
    targetLoad = load;
    return load;
  }

  function selectTarget(target: ExecutionTargetSelection): void {
    // A path typed for one machine means nothing on the other; carrying it over would
    // offer to open a path the user never chose there.
    const crossesMachines = !localTargetChosen !== (target.kind !== "local");
    if (crossesMachines) path = "";
    localTargetChoice = target;
    onSelectTarget?.(target);
  }

  const filteredRecent = $derived(
    recent.filter((entry) => {
      const needle = query.trim().toLocaleLowerCase();
      return (
        needle.length === 0 ||
        `${entry.displayName} ${entry.displayPath}`
          .toLocaleLowerCase()
          .includes(needle)
      );
    }),
  );

  async function browse(pathToRead: string): Promise<void> {
    pickerBusy = true;
    pickerError = null;
    try {
      const result = await onBrowse(pathToRead);
      pickerPath = result.path;
      pickerData = result;
    } catch (error) {
      pickerError =
        error instanceof Error
          ? error.message
          : t("launcher.readDirectoryFailed");
    } finally {
      pickerBusy = false;
    }
  }

  function openPicker(): void {
    // The dialog lists the host's own machine. For a remote target it must never open,
    // however it was reached: a directory listing here is not a listing there.
    if (remoteTargetChosen) return;
    pickerOpen = true;
    void browse(path.trim().length > 0 ? path.trim() : "~");
  }

  function chooseRepository(repositoryPath: string): void {
    path = repositoryPath;
    pickerOpen = false;
  }

  /**
   * The host's own answer about the OS picker decides whether the button exists; a
   * remote target hides it regardless, because the dialog lists this machine.
   */
  const localFolderPickerAvailable = $derived(
    onPickLocalFolder !== undefined &&
      !remoteTargetChosen &&
      targetLoad !== null &&
      targetLoad.capabilities !== null &&
      targetLoad.capabilities.localFolderPicker === true,
  );

  async function pickLocalFolder(): Promise<void> {
    if (onPickLocalFolder === undefined || nativePickerBusy) return;
    nativePickerBusy = true;
    nativePickerError = null;
    try {
      const chosen = await onPickLocalFolder();
      // A cancelled dialog answers null and opens nothing: an answer, not an error.
      if (chosen !== null && chosen.trim().length > 0) onOpen(chosen.trim());
    } catch (error) {
      // A host that cannot open a dialog (any browser build) refuses the click; the
      // refusal is shown next to the form instead of the click doing nothing.
      nativePickerError =
        error instanceof Error
          ? error.message
          : t("launcher.folderPickerFailed");
    } finally {
      nativePickerBusy = false;
    }
  }
</script>

<section
  class="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6"
  data-testid="repository-launcher"
>
  {#if dropPathsActive}
    <div
      class="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-4 border-dashed border-primary/60 bg-background/70"
      data-testid="launcher-drop-overlay"
    >
      <p class="rounded-md bg-background px-4 py-2 text-sm font-medium">
        {t("launcher.dropFolder")}
      </p>
    </div>
  {/if}
  <div>
    <p
      class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
    >
      {t("launcher.workspace")}
    </p>
    <h1 class="mt-1 text-2xl font-semibold tracking-tight">{t("launcher.repositories")}</h1>
    <p class="mt-1 max-w-2xl text-sm text-muted-foreground">
      {t("launcher.description")}
    </p>
  </div>

  <div
    class="flex flex-wrap gap-2"
    role="tablist"
    aria-label={t("launcher.actions")}
  >
    <Button
      type="button"
      variant={mode === "open" ? "default" : "outline"}
      onclick={() => (mode = "open")}
      data-testid="launcher-open-tab"
      ><FolderOpen data-icon="inline-start" />{t("launcher.open")}</Button
    >
    <Button
      type="button"
      variant={mode === "create" ? "default" : "outline"}
      onclick={() => (mode = "create")}
      data-testid="launcher-create-tab"
      ><GitBranchPlus data-icon="inline-start" />{t("launcher.cloneCreate")}</Button
    >
  </div>

  {#if mode === "open"}
    {#if targetControlAvailable}
      <div
        class="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-panel px-4 py-3"
        data-testid="execution-target-control"
      >
        <span
          class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
          >{t("launcher.location")}</span
        >
        <Button
          type="button"
          size="sm"
          variant="outline"
          onclick={() => (targetPickerOpen = true)}
          {disabled}
          data-testid="execution-target-open"
        >
          <MonitorSmartphone data-icon="inline-start" />{chosenTargetLabel}
        </Button>
        {#if remoteTargetChosen}
          <span
            class="min-w-0 flex-1 text-xs text-muted-foreground"
            data-testid="execution-target-note"
          >
            {t("launcher.remoteNote").replace("{target}", () => chosenTargetLabel)}
          </span>
        {/if}
      </div>
    {/if}
    {#if targetError !== null}
      <p
        class="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
        data-testid="launcher-target-error"
      >
        {targetError}
      </p>
    {/if}
    {#if targetProgress !== null}
      <p
        class="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        data-testid="launcher-target-progress"
      >
        {targetProgress}…
      </p>
    {/if}
    <form
      class="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-panel p-4"
      onsubmit={(event) => {
        event.preventDefault();
        if (path.trim().length > 0 && !openPending) onOpen(path.trim());
      }}
    >
      {#if localFolderPickerAvailable}
        <Button
          type="button"
          variant="outline"
          onclick={pickLocalFolder}
          disabled={disabled || nativePickerBusy}
          data-testid="launcher-native-picker"
          ><FolderOpen data-icon="inline-start" />{t(nativePickerBusy
            ? "launcher.choosing"
            : "launcher.chooseFolder")}</Button
        >
      {/if}
      {#if nativePickerError !== null}
        <p
          class="basis-full text-xs text-danger"
          data-testid="launcher-native-picker-error"
        >
          {nativePickerError}
        </p>
      {/if}
      <label class="min-w-64 flex-1 text-xs font-medium" for="launcher-path"
        >{pathFieldLabel}
        <Input
          id="launcher-path"
          class="mt-1"
          placeholder={pathFieldPlaceholder}
          bind:value={path}
          {disabled}
        />
      </label>
      <Button
        type="button"
        variant="outline"
        onclick={openPicker}
        disabled={disabled || remoteTargetChosen}
        title={remoteBrowseReason ?? undefined}
        data-testid="launcher-browse"
        ><FolderOpen data-icon="inline-start" />{t("launcher.browse")}</Button
      >
      <Button
        type="submit"
        disabled={disabled || path.trim().length === 0 || openPending}
        data-testid="launcher-open"
        ><FolderOpen data-icon="inline-start" />{t("launcher.openRepository")}</Button
      >
      {#if remoteBrowseReason !== null}
        <p
          class="basis-full text-xs text-muted-foreground"
          data-testid="launcher-remote-browse-note"
        >
          {remoteBrowseReason}
        </p>
      {/if}
    </form>
  {:else if roots.length > 0}
    <div class="rounded-lg border border-border bg-panel p-4">
      <RepositoryPanel
        {roots}
        available={repositoryCreationAvailable}
        {disabled}
        {busy}
        {message}
        {onInit}
        {onClone}
      />
    </div>
  {:else}
    <div
      class="rounded-lg border border-dashed border-border bg-panel p-5 text-sm text-muted-foreground"
    >
      {t("launcher.noWorkspaceRoot")}
    </div>
  {/if}

  <div class="flex flex-col gap-2 rounded-lg border border-border bg-panel p-4">
    <div class="flex items-center justify-between gap-3">
      <h2 class="flex items-center gap-2 text-sm font-semibold">
        <Clock3 class="size-4 text-primary" />{t("launcher.recent")}
      </h2>
      <Badge tone="muted">{i18n.count(filteredRecent.length)}</Badge>
    </div>
    <label class="relative block" for="recent-repositories-search">
      <Search
        class="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground"
      />
      <Input
        id="recent-repositories-search"
        class="pl-8 text-xs"
        placeholder={t("launcher.searchRecent")}
        bind:value={query}
      />
    </label>
    {#if filteredRecent.length === 0}
      <p class="py-5 text-center text-sm text-muted-foreground">
        {t("launcher.noRecentMatch")}
      </p>
    {:else}
      <div class="grid gap-1">
        {#each filteredRecent as entry (executionLocationKey(entry.target, entry.displayPath))}
          <button
            type="button"
            class={cn(
              "flex items-start gap-3 rounded-md border border-transparent px-3 py-2 text-left hover:border-border hover:bg-muted/50",
              !entry.available && "opacity-60",
            )}
            onclick={() => onRecent(entry)}
          >
            <UploadCloud class="mt-0.5 size-4 shrink-0 text-primary" />
            <span class="min-w-0 flex-1"
              ><span class="block truncate text-sm font-medium"
                >{entry.displayName}</span
              ><span
                class="block truncate font-mono text-[11px] text-muted-foreground"
                >{entry.displayPath}</span
              ></span
            >
            {#if !entry.available}<Badge tone="muted">{t("launcher.unavailable")}</Badge>{/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</section>

<Dialog.Root bind:open={pickerOpen}>
  <Dialog.Content class="max-w-2xl" data-testid="repository-path-picker">
    <Dialog.Header>
      <Dialog.Title>{t("launcher.chooseRepositoryFolder")}</Dialog.Title>
      <Dialog.Description>
        {t("launcher.folderBrowseDescription")}
      </Dialog.Description>
    </Dialog.Header>

    <form
      class="flex items-center gap-2"
      onsubmit={(event) => {
        event.preventDefault();
        void browse(pickerPath);
      }}
    >
      <Input
        class="min-w-0 flex-1 font-mono text-xs"
        bind:value={pickerPath}
        aria-label={t("launcher.pathToBrowse")}
      />
      <Button type="submit" variant="outline" disabled={pickerBusy}>{t("launcher.go")}</Button>
    </form>

    {#if pickerError !== null}
      <p
        class="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
      >
        {pickerError}
      </p>
    {:else if pickerData !== null}
      <div
        class="flex items-center justify-between gap-3 text-xs text-muted-foreground"
      >
        <span class="min-w-0 truncate font-mono" title={pickerData.path}
          >{pickerData.path}</span
        >
        {#if pickerData.parentPath !== null}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onclick={() => void browse(pickerData?.parentPath ?? "~")}
            disabled={pickerBusy}
          >
            <ChevronLeft data-icon="inline-start" />{t("launcher.up")}
          </Button>
        {/if}
      </div>
      <div class="max-h-72 overflow-y-auto rounded-md border border-border">
        {#if pickerData.entries.length === 0}
          <p class="p-4 text-center text-xs text-muted-foreground">
            {t("launcher.noDirectories")}
          </p>
        {:else}
          {#each pickerData.entries as entry (entry.path)}
            <div
              class="flex items-center gap-2 border-b border-border/60 px-3 py-2 last:border-b-0 hover:bg-muted/40"
            >
              <FolderOpen class="size-4 shrink-0 text-primary" />
              <span class="min-w-0 flex-1 truncate text-sm" title={entry.path}
                >{entry.name}</span
              >
              {#if entry.kind === "repository"}
                <Button
                  type="button"
                  size="sm"
                  onclick={() => chooseRepository(entry.path)}>{t("launcher.open")}</Button
                >
              {:else}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onclick={() => void browse(entry.path)}
                  disabled={pickerBusy}>{t("launcher.browse")}</Button
                >
              {/if}
            </div>
          {/each}
        {/if}
      </div>
      {#if pickerData.truncated}
        <p class="text-xs text-muted-foreground">
          {t("launcher.truncatedDirectories")}
        </p>
      {/if}
    {:else if pickerBusy}
      <p class="p-6 text-center text-xs text-muted-foreground">
        {t("launcher.readingDirectories")}
      </p>
    {/if}

    <Dialog.Footer>
      <Button variant="ghost" onclick={() => (pickerOpen = false)}
        >{t("action.cancel")}</Button
      >
      <Button
        disabled={pickerData === null}
        onclick={() => chooseRepository(pickerData?.path ?? "")}
      >
        {t("launcher.useFolder")}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

{#if hostService !== null}
  <ExecutionTargetPicker
    bind:open={targetPickerOpen}
    loadOptions={refreshTargetOptions}
    onSelectTarget={selectTarget}
  />
{/if}
