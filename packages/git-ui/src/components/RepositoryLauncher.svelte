<script lang="ts">
  /** GitKraken-style repository entry screen for local Open, Recent, Clone and Create. */
  import {
    Clock3,
    FolderOpen,
    GitBranchPlus,
    Search,
    UploadCloud,
  } from "@lucide/svelte";
  import { Badge } from "./ui/badge/index.js";
  import { Button } from "./ui/button/index.js";
  import { Input } from "./ui/input/index.js";
  import RepositoryPanel, {
    type CloneRequest,
    type InitRequest,
    type WorkspaceRoot,
  } from "./RepositoryPanel.svelte";
  import { cn } from "../lib/utils.js";

  export interface RecentRepository {
    readonly repositoryId: string;
    readonly displayName: string;
    readonly displayPath: string;
    readonly lastOpenedAt: string;
    readonly available: boolean;
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
    onRecent: (entry: RecentRepository) => void;
    onInit: (request: InitRequest) => void;
    onClone: (request: CloneRequest) => void;
  }

  let {
    recent,
    roots,
    repositoryCreationAvailable,
    disabled = false,
    busy = false,
    message = null,
    onOpen,
    onRecent,
    onInit,
    onClone,
  }: Props = $props();

  let mode = $state<"open" | "create">("open");
  let path = $state("");
  let query = $state("");
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
</script>

<section
  class="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6"
  data-testid="repository-launcher"
>
  <div>
    <p
      class="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground"
    >
      Workspace
    </p>
    <h1 class="mt-1 text-2xl font-semibold tracking-tight">Repositories</h1>
    <p class="mt-1 max-w-2xl text-sm text-muted-foreground">
      Open a local repository, start from a clone, or create one. Recent entries
      are only repositories you explicitly opened.
    </p>
  </div>

  <div
    class="flex flex-wrap gap-2"
    role="tablist"
    aria-label="Repository actions"
  >
    <Button
      type="button"
      variant={mode === "open" ? "default" : "outline"}
      onclick={() => (mode = "open")}
      data-testid="launcher-open-tab"
      ><FolderOpen data-icon="inline-start" />Open</Button
    >
    <Button
      type="button"
      variant={mode === "create" ? "default" : "outline"}
      onclick={() => (mode = "create")}
      data-testid="launcher-create-tab"
      ><GitBranchPlus data-icon="inline-start" />Clone / Create</Button
    >
  </div>

  {#if mode === "open"}
    <form
      class="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-panel p-4"
      onsubmit={(event) => {
        event.preventDefault();
        if (path.trim().length > 0) onOpen(path.trim());
      }}
    >
      <label class="min-w-64 flex-1 text-xs font-medium" for="launcher-path"
        >Local repository path
        <Input
          id="launcher-path"
          class="mt-1"
          placeholder="/absolute/path/to/repository"
          bind:value={path}
          {disabled}
        />
      </label>
      <Button type="submit" disabled={disabled || path.trim().length === 0}
        ><FolderOpen data-icon="inline-start" />Open repository</Button
      >
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
      Open one local repository first to approve a workspace root. Clone and
      Create will then use that explicit root.
    </div>
  {/if}

  <div class="flex flex-col gap-2 rounded-lg border border-border bg-panel p-4">
    <div class="flex items-center justify-between gap-3">
      <h2 class="flex items-center gap-2 text-sm font-semibold">
        <Clock3 class="size-4 text-primary" />Recent
      </h2>
      <Badge tone="muted">{filteredRecent.length}</Badge>
    </div>
    <label class="relative block" for="recent-repositories-search">
      <Search
        class="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground"
      />
      <Input
        id="recent-repositories-search"
        class="pl-8 text-xs"
        placeholder="Search recent repositories"
        bind:value={query}
      />
    </label>
    {#if filteredRecent.length === 0}
      <p class="py-5 text-center text-sm text-muted-foreground">
        No recent repositories match.
      </p>
    {:else}
      <div class="grid gap-1">
        {#each filteredRecent as entry (entry.repositoryId)}
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
            {#if !entry.available}<Badge tone="muted">unavailable</Badge>{/if}
          </button>
        {/each}
      </div>
    {/if}
  </div>
</section>
