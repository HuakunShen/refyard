<script lang="ts">
  /**
   * Submodules: what the parent records, what its index has, what is checked out.
   *
   * The three object names are shown side by side and never summarized into an
   * "up to date" flag, because they disagree in ways that matter: a submodule can be
   * initialized at the right commit while the index already points at another one.
   * `dirty` and `unknown` are distinct badges for the same reason — a checkout this
   * build could not read is not evidence that it is clean.
   *
   * `Add` clones from the URL in the field, so the panel says so next to it; nothing
   * here runs `--remote` or `--force`, and `update` restores the recorded commit.
   */
  import { Badge } from "./ui/badge/index.js";
  import { Button } from "./ui/button/index.js";
  import { cn } from "../lib/utils.js";
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";
  import type { TranslationKey } from "../lib/i18n/types.js";

  interface SubmoduleEntry {
    readonly name: string;
    readonly pathId: string;
    readonly displayPath: string;
    readonly recordedOid: string | null;
    readonly indexOid: string | null;
    readonly actualOid: string | null;
    readonly state:
      "uninitialized" | "initialized" | "outOfSync" | "dirty" | "unknown";
    readonly urlDisplay: string;
    readonly branchName: string | null;
  }

  interface Props {
    submodules: readonly SubmoduleEntry[] | null;
    disabled?: boolean;
    busy?: boolean;
    message?: string | null;
    onAdd: (input: {
      remoteUrl: string;
      relativePath: string;
      branchName: string | null;
    }) => void;
    onUpdate: (pathIds: readonly string[], recursive: boolean) => void;
    onSync: (pathIds: readonly string[], recursive: boolean) => void;
    class?: string;
  }

  let {
    submodules,
    disabled = false,
    busy = false,
    message = null,
    onAdd,
    onUpdate,
    onSync,
    class: className = "",
  }: Props = $props();
  const { t } = useGitViewI18n();
  const stateKeys: Readonly<Record<SubmoduleEntry["state"], TranslationKey>> = {
    uninitialized: "submodule.state.uninitialized", initialized: "submodule.state.initialized",
    outOfSync: "submodule.state.outOfSync", dirty: "submodule.state.dirty", unknown: "submodule.state.unknown",
  };

  let remoteUrl = $state("");
  let relativePath = $state("");
  let branchName = $state("");
  let recursive = $state(false);
  let selected = $state<readonly string[]>([]);

  const shortOid = (value: string | null): string =>
    value === null ? "—" : value.slice(0, 8);

  function toggle(pathId: string): void {
    selected = selected.includes(pathId)
      ? selected.filter((candidate) => candidate !== pathId)
      : [...selected, pathId];
  }

  /** Every action applies to the selection, or to all rows when nothing is picked. */
  const targets = $derived(
    selected.length > 0
      ? selected
      : (submodules ?? [])
          .filter((entry) => entry.state !== "unknown")
          .map((entry) => entry.pathId),
  );
</script>

<div
  class={cn("flex flex-col gap-2.5", className)}
  data-testid="submodule-panel"
>
  <!-- Add submodule form -->
  <div
    class="flex flex-col gap-2 rounded-lg border border-border/50 bg-card/40 p-2.5"
  >
    <span
      class="text-[11px] font-semibold tracking-wider text-ink-muted uppercase"
    >
      {t("submodule.addTitle")}
    </span>
    <input
      class="w-full rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
      placeholder={t("submodule.urlPlaceholder")}
      aria-label={t("submodule.url")}
      bind:value={remoteUrl}
      disabled={disabled || busy}
    />
    <div class="flex items-center gap-2">
      <input
        class="min-w-0 flex-1 rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        placeholder={t("submodule.pathExample")}
        aria-label={t("submodule.path")}
        bind:value={relativePath}
        disabled={disabled || busy}
      />
      <input
        class="w-28 rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring shrink-0"
        placeholder={t("submodule.branchPlaceholder")}
        aria-label={t("submodule.branch")}
        bind:value={branchName}
        disabled={disabled || busy}
      />
      <Button
        size="sm"
        class="h-7 text-xs px-3 shrink-0"
        disabled={disabled ||
          busy ||
          remoteUrl.trim().length === 0 ||
          relativePath.trim().length === 0}
        onclick={() => {
          onAdd({
            remoteUrl: remoteUrl.trim(),
            relativePath: relativePath.trim(),
            branchName:
              branchName.trim().length === 0 ? null : branchName.trim(),
          });
          remoteUrl = "";
          relativePath = "";
          branchName = "";
        }}
        data-testid="add-submodule"
      >
        {t("submodule.add")}
      </Button>
    </div>
  </div>

  <!-- Actions for existing submodules -->
  <div
    class="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-border/30"
  >
    <label
      class="flex items-center gap-1.5 text-xs text-ink-muted cursor-pointer select-none"
    >
      <input
        type="checkbox"
        class="size-3.5 accent-primary rounded"
        aria-label={t("submodule.recursive")}
        bind:checked={recursive}
        disabled={disabled || busy}
      />
      {t("submodule.recursive")}
    </label>
    <div class="flex items-center gap-1.5">
      <Button
        size="sm"
        variant="outline"
        class="h-6 text-xs px-2 shadow-none"
        disabled={disabled || busy || targets.length === 0}
        onclick={() => onUpdate(targets, recursive)}
        data-testid="update-submodule"
      >
        {t("submodule.update")}
      </Button>
      <Button
        size="sm"
        variant="outline"
        class="h-6 text-xs px-2 shadow-none"
        disabled={disabled || busy || targets.length === 0}
        onclick={() => onSync(targets, recursive)}
        data-testid="sync-submodule"
      >
        {t("submodule.syncUrl")}
      </Button>
    </div>
  </div>

  <!-- Submodule list -->
  {#if submodules === null}
    <p class="text-xs text-ink-faint">{t("submodule.notLoaded")}</p>
  {:else if submodules.length === 0}
    <p class="text-xs text-ink-faint italic py-1" data-testid="submodule-list">
      {t("submodule.empty")}
    </p>
  {:else}
    <ul
      class="flex max-h-60 flex-col gap-1.5 overflow-y-auto pr-0.5"
      data-testid="submodule-list"
    >
      {#each submodules as entry (entry.pathId)}
        <li
          class="flex flex-col gap-1 rounded-lg border border-border/50 bg-card/60 p-2 hover:border-border hover:bg-accent/30 transition-all"
        >
          <div class="flex items-center gap-2 min-w-0">
            <input
              type="checkbox"
              class="size-3.5 accent-primary rounded shrink-0"
              aria-label={t("submodule.select").replace("{path}", () => entry.displayPath)}
              checked={selected.includes(entry.pathId)}
              onchange={() => toggle(entry.pathId)}
              disabled={disabled || busy}
            />
            <Badge
              tone={entry.state === "initialized"
                ? "muted"
                : entry.state === "unknown"
                  ? "warn"
                  : "danger"}
              class="text-[10px] h-4.5 px-1.5 shrink-0"
            >
              {t(stateKeys[entry.state])}
            </Badge>
            <span
              class="min-w-0 flex-1 truncate font-mono text-xs font-medium text-foreground"
              title={entry.displayPath}
            >
              {entry.displayPath}
            </span>
          </div>

          <div
            class="flex items-center justify-between text-[11px] text-ink-faint font-mono pl-5"
          >
            <span title={t("submodule.oidTitle")}>
              {shortOid(entry.recordedOid)} · {shortOid(entry.indexOid)} · {shortOid(
                entry.actualOid,
              )}
            </span>
            <span
              class="truncate max-w-[140px] text-right"
              title={entry.urlDisplay}
            >
              {entry.urlDisplay}
            </span>
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if message !== null}
    <p class="text-xs text-ink-muted" data-testid="submodule-message-result">
      {message}
    </p>
  {/if}
</div>
