<script lang="ts">
  /**
   * Branches, tags and remotes for one repository.
   *
   * The refs read redacts credentials before it leaves the host, so a URL shown here is
   * safe to display and is displayed as-is rather than parsed into host and path — that
   * parsing is what turns a redacted URL into a wrong one.
   *
   * `ahead`/`behind` describe local remote-tracking refs, not the server's state, and the
   * pane says so: a user who reads "2 behind" as a live fact will be surprised by a fetch.
   */
  import type { RefsSnapshot } from "@refyard/git-contract";
  import Badge from "../ui/Badge.svelte";
  import { cn } from "../lib/utils.js";
  import { shortOid } from "../lib/format.js";

  interface Props {
    refs: RefsSnapshot | null;
    class?: string;
  }

  let { refs, class: className = "" }: Props = $props();
</script>

{#if refs === null}
  <p class={cn("text-xs text-ink-faint", className)}>No refs loaded.</p>
{:else}
  <div class={cn("flex flex-col gap-4", className)}>
    <section class="flex flex-col gap-1.5">
      <h3 class="text-xs font-semibold tracking-wide text-ink-muted uppercase">
        Branches <span class="font-normal text-ink-faint"
          >({refs.branches.length})</span
        >
      </h3>
      {#if refs.branches.length === 0}
        <p class="text-xs text-ink-faint">No branches yet.</p>
      {:else}
        <ul class="flex flex-col gap-0.5">
          {#each refs.branches as branch (branch.fullName)}
            <li class="flex items-center gap-2 text-sm">
              <span
                class="min-w-0 flex-1 truncate text-ink"
                title={branch.fullName}>{branch.name}</span
              >
              {#if branch.isCurrent}
                <Badge tone="head">HEAD</Badge>
              {/if}
              {#if branch.upstream !== null}
                {#if branch.upstream.gone}
                  <Badge
                    tone="danger"
                    title={`upstream ${branch.upstream.fullName} is gone`}
                    >gone</Badge
                  >
                {:else if branch.upstream.ahead > 0 || branch.upstream.behind > 0}
                  <span class="text-xs text-ink-muted">
                    {branch.upstream.ahead}↑ {branch.upstream.behind}↓
                  </span>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="flex flex-col gap-1.5">
      <h3 class="text-xs font-semibold tracking-wide text-ink-muted uppercase">
        Tags <span class="font-normal text-ink-faint">({refs.tags.length})</span
        >
      </h3>
      {#if refs.tags.length === 0}
        <p class="text-xs text-ink-faint">No tags.</p>
      {:else}
        <ul class="flex flex-col gap-0.5">
          {#each refs.tags as tag (tag.fullName)}
            <li class="flex items-center gap-2 text-sm">
              <span
                class="min-w-0 flex-1 truncate text-ink"
                title={tag.fullName}>{tag.name}</span
              >
              {#if tag.annotated}
                <Badge
                  tone="tag"
                  title={`annotated tag object ${shortOid(tag.oid)}`}
                  >annotated</Badge
                >
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section class="flex flex-col gap-1.5">
      <h3 class="text-xs font-semibold tracking-wide text-ink-muted uppercase">
        Remotes <span class="font-normal text-ink-faint"
          >({refs.remotes.length})</span
        >
      </h3>
      {#if refs.remotes.length === 0}
        <p class="text-xs text-ink-faint">No remotes configured.</p>
      {:else}
        <ul class="flex flex-col gap-1">
          {#each refs.remotes as remote (remote.name)}
            <li class="flex flex-col text-xs">
              <span class="font-medium text-ink">{remote.name}</span>
              <span
                class="truncate text-ink-faint"
                title={remote.fetchUrlDisplay}
              >
                {remote.fetchUrlDisplay}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <p class="text-xs text-ink-faint">
      Read at <time datetime={refs.readAt}>{refs.readAt}</time>. Ahead/behind
      reflect local remote-tracking refs after the last fetch, not the server's
      current state.
    </p>
  </div>
{/if}
