<script lang="ts">
  /**
   * The full message and metadata of one commit.
   *
   * The summary row already shows subject, author and date; this pane adds the body and
   * the facts a reader needs before trusting a commit: committer (who wrote it down, not
   * who wrote it), tree, parents, signature, and the declared encoding when the message
   * is not UTF-8. The body is shown in `<pre>` so a message with its own indentation and
   * blank lines is not reflowed into something the author did not write.
   */
  import type { CommitDetail, CommitSummary } from "@refyard/git-contract";
  import Copy from "@lucide/svelte/icons/copy";
  import Check from "@lucide/svelte/icons/check";
  import { Badge } from "./ui/badge/index.js";
  import { absoluteTime, shortOid } from "../lib/format.js";
  import { cn } from "../lib/utils.js";

  interface Props {
    commit: CommitSummary | null;
    detail: CommitDetail | null;
    class?: string;
  }

  let { commit, detail, class: className = "" }: Props = $props();

  let copiedOid = $state(false);
  let copyTimeout: ReturnType<typeof setTimeout> | null = null;

  async function copyCommitOid(oid: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(oid);
      copiedOid = true;
      if (copyTimeout !== null) {
        clearTimeout(copyTimeout);
      }
      copyTimeout = setTimeout(() => {
        copiedOid = false;
      }, 2000);
    }
  }
</script>

<div class={cn("flex flex-col gap-3 overflow-auto p-3", className)}>
  {#if commit === null}
    <p class="text-sm text-ink-faint">Select a commit to read it.</p>
  {:else}
    <header class="flex flex-col gap-1">
      <h2 class="text-sm font-medium text-ink">{commit.subject}</h2>
      <div class="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        <div class="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground/85 border border-border/60">
          <span>{commit.oid}</span>
          <button
            type="button"
            class="rounded p-0.5 hover:text-foreground text-muted-foreground transition-colors hover:bg-background/80"
            title={copiedOid ? "Copied!" : "Copy full commit SHA"}
            onclick={() => copyCommitOid(commit.oid)}
          >
            {#if copiedOid}
              <Check class="size-3 text-emerald-500" />
            {:else}
              <Copy class="size-3" />
            {/if}
          </button>
        </div>
        {#if commit.signed}
          <Badge tone="muted">signed</Badge>
        {/if}
        {#if commit.missingParents.length > 0}
          <Badge tone="warn">
            {commit.missingParents.length} parent
            {commit.missingParents.length === 1 ? "object" : "objects"} not present
            locally
          </Badge>
        {/if}
        {#each commit.refNames as refName (refName)}
          <Badge tone="branch">{refName}</Badge>
        {/each}
      </div>
    </header>

    {#if detail === null}
      <p class="text-xs text-ink-faint">Loading the full message…</p>
    {:else}
      <dl class="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-xs">
        <dt class="text-ink-faint">author</dt>
        <dd class="text-ink">
          {detail.authorName} &lt;{detail.authorEmail}&gt;
        </dd>
        <dt class="text-ink-faint">authored</dt>
        <dd class="text-ink">
          <time datetime={detail.authoredAt} title={detail.authoredAt}
            >{absoluteTime(detail.authoredAt)}</time
          >
        </dd>
        <dt class="text-ink-faint">committer</dt>
        <dd class="text-ink">
          {detail.committerName} &lt;{detail.committerEmail}&gt;
        </dd>
        <dt class="text-ink-faint">committed</dt>
        <dd class="text-ink">
          <time datetime={detail.committedAt} title={detail.committedAt}
            >{absoluteTime(detail.committedAt)}</time
          >
        </dd>
        <dt class="text-ink-faint">tree</dt>
        <dd class="font-mono text-ink">{shortOid(detail.treeOid)}</dd>
        <dt class="text-ink-faint">parents</dt>
        <dd class="font-mono text-ink">
          {detail.parents.length === 0
            ? "(root commit)"
            : detail.parents.map(shortOid).join(" ")}
        </dd>
        {#if detail.encoding !== null}
          <dt class="text-ink-faint">encoding</dt>
          <dd class="text-ink">{detail.encoding}</dd>
        {/if}
      </dl>

      {#if detail.body.length > 0}
        <pre
          class="rounded-md border border-border bg-panel p-2 text-xs whitespace-pre-wrap text-ink">{detail.body}</pre>
      {:else}
        <p class="text-xs text-ink-faint">
          This commit has no message body beyond its subject.
        </p>
      {/if}
    {/if}
  {/if}
</div>
