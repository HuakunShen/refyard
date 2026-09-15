<script lang="ts">
  /**
   * Explicitly add or revoke a repository grant.
   *
   * This panel accepts one path a person typed. It never lists filesystem candidates or
   * turns a parent directory into a grant; the host validates the path and returns the
   * updated approved list. Revocation is intentionally a visible per-row action so the
   * user can remove a grant without editing a hidden configuration file.
   */
  import { Badge } from "./ui/badge/index.js";
  import { Button } from "./ui/button/index.js";
  import { cn } from "../lib/utils.js";

  export interface ManagedRepository {
    readonly repositoryId: string;
    readonly displayName: string;
    readonly displayPath: string;
  }

  interface Props {
    repositories: readonly ManagedRepository[];
    disabled?: boolean;
    busy?: boolean;
    message?: string | null;
    onRegister: (path: string) => void;
    onRevoke: (repositoryId: string) => void;
    class?: string;
  }

  let {
    repositories,
    disabled = false,
    busy = false,
    message = null,
    onRegister,
    onRevoke,
    class: className = "",
  }: Props = $props();

  let path = $state("");
  const locked = $derived(disabled || busy);
  const ready = $derived(!locked && path.trim().length > 0);

  function submit(): void {
    if (!ready) {
      return;
    }
    onRegister(path.trim());
    path = "";
  }
</script>

<section
  class={cn("flex flex-col gap-2", className)}
  data-testid="repository-access-panel"
>
  <div class="flex items-center gap-2">
    <h3 class="text-xs font-semibold uppercase tracking-wide text-ink-muted">
      Managed repositories
    </h3>
    <Badge tone="muted">approval required</Badge>
  </div>
  <p class="text-xs text-ink-faint">
    Add one exact absolute path you chose. Refyard never scans this machine for
    repositories.
  </p>
  <div class="flex gap-2">
    <input
      class="min-w-0 flex-1 rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
      placeholder="/absolute/path/to/repository"
      aria-label="repository path to approve"
      bind:value={path}
      disabled={locked}
      data-testid="repository-register-path"
    />
    <Button
      size="sm"
      class="h-7 text-xs"
      disabled={!ready}
      onclick={submit}
      data-testid="repository-register"
    >
      {busy ? "Working…" : "Approve"}
    </Button>
  </div>

  {#if repositories.length > 0}
    <ul class="flex flex-col gap-1">
      {#each repositories as repository (repository.repositoryId)}
        <li
          class="flex items-center gap-2 rounded border border-border/70 bg-panel/50 px-2 py-1.5"
          data-testid={`repository-access-row-${repository.repositoryId}`}
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate text-xs font-medium text-ink"
              >{repository.displayName}</span
            >
            <span class="block truncate font-mono text-[11px] text-ink-faint"
              >{repository.displayPath}</span
            >
          </span>
          <Button
            size="sm"
            variant="outline"
            class="h-7 shrink-0 text-xs"
            disabled={locked}
            onclick={() => onRevoke(repository.repositoryId)}
            data-testid={`repository-revoke-${repository.repositoryId}`}
          >
            Revoke
          </Button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if message !== null}
    <p class="text-xs text-ink-muted" data-testid="repository-access-message">
      {message}
    </p>
  {/if}
</section>
