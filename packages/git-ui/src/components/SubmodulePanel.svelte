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

<div class={cn("flex flex-col gap-2", className)} data-testid="submodule-panel">
  <div class="flex flex-wrap items-center gap-2">
    <input
      class="min-w-40 flex-1 rounded border border-input bg-transparent px-2 py-1 font-mono text-xs"
      placeholder="remote URL (cloned when added)"
      aria-label="submodule url"
      bind:value={remoteUrl}
      disabled={disabled || busy}
    />
    <input
      class="w-32 rounded border border-input bg-transparent px-2 py-1 font-mono text-xs"
      placeholder="vendor/lib"
      aria-label="submodule path"
      bind:value={relativePath}
      disabled={disabled || busy}
    />
    <input
      class="w-28 rounded border border-input bg-transparent px-2 py-1 font-mono text-xs"
      placeholder="branch (tracked)"
      aria-label="submodule branch"
      bind:value={branchName}
      disabled={disabled || busy}
    />
    <Button
      size="sm"
      disabled={disabled ||
        busy ||
        remoteUrl.trim().length === 0 ||
        relativePath.trim().length === 0}
      onclick={() => {
        onAdd({
          remoteUrl: remoteUrl.trim(),
          relativePath: relativePath.trim(),
          branchName: branchName.trim().length === 0 ? null : branchName.trim(),
        });
        remoteUrl = "";
        relativePath = "";
        branchName = "";
      }}
      data-testid="add-submodule"
    >
      Add
    </Button>
  </div>

  <div class="flex flex-wrap items-center gap-2">
    <label class="flex items-center gap-1 text-xs text-ink-muted">
      <input
        type="checkbox"
        aria-label="submodule recursive"
        bind:checked={recursive}
        disabled={disabled || busy}
      />
      recursive
    </label>
    <Button
      size="sm"
      variant="outline"
      disabled={disabled || busy || targets.length === 0}
      onclick={() => onUpdate(targets, recursive)}
      data-testid="update-submodule"
    >
      Update (recorded commit)
    </Button>
    <Button
      size="sm"
      variant="outline"
      disabled={disabled || busy || targets.length === 0}
      onclick={() => onSync(targets, recursive)}
      data-testid="sync-submodule"
    >
      Sync URL
    </Button>
  </div>

  {#if submodules === null}
    <p class="text-xs text-ink-faint">No submodules loaded.</p>
  {:else if submodules.length === 0}
    <p class="text-xs text-ink-faint" data-testid="submodule-list">None.</p>
  {:else}
    <ul
      class="flex max-h-64 flex-col gap-1 overflow-y-auto"
      data-testid="submodule-list"
    >
      {#each submodules as entry (entry.pathId)}
        <li class="flex flex-wrap items-center gap-2 rounded px-1 py-0.5">
          <input
            type="checkbox"
            aria-label={`select ${entry.displayPath}`}
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
          >
            {entry.state}
          </Badge>
          <span
            class="min-w-0 flex-1 truncate font-mono text-xs"
            title={entry.displayPath}
          >
            {entry.displayPath}
          </span>
          <span
            class="font-mono text-xs text-ink-muted"
            title="recorded in HEAD / index / checked out"
          >
            {shortOid(entry.recordedOid)} · {shortOid(entry.indexOid)} · {shortOid(
              entry.actualOid,
            )}
          </span>
          <span
            class="truncate text-xs text-ink-faint"
            title={entry.urlDisplay}
          >
            {entry.urlDisplay}
          </span>
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
