<script lang="ts">
  /**
   * Tags: create (lightweight or annotated), delete locally, push one.
   *
   * Never overwrites: an existing name is refused by the host and shown as the
   * refusal it is. Deleting is local only — the panel says so, because "delete" and
   * "delete everywhere" are different requests and only the first is offered.
   */
  import Tag from "@lucide/svelte/icons/tag";
  import { Badge } from "./ui/badge/index.js";
  import { Button } from "./ui/button/index.js";
  import ConfirmAction from "./ConfirmAction.svelte";
  import { cn } from "../lib/utils.js";

  interface TagEntry {
    readonly name: string;
    readonly oid: string;
    readonly annotated: boolean;
  }

  interface Props {
    tags: readonly TagEntry[] | null;
    remoteName: string | null;
    disabled?: boolean;
    busy?: boolean;
    message?: string | null;
    onCreate: (tagName: string, annotation: string | null) => void;
    onDelete: (tagName: string) => void;
    onPush: (tagName: string) => void;
    class?: string;
  }

  let {
    tags,
    remoteName,
    disabled = false,
    busy = false,
    message = null,
    onCreate,
    onDelete,
    onPush,
    class: className = "",
  }: Props = $props();

  let tagName = $state("");
  let annotation = $state("");
</script>

<div class={cn("flex flex-col gap-2.5", className)} data-testid="tag-panel">
  <!-- Create tag form -->
  <div
    class="flex flex-col gap-2 rounded-lg border border-border/50 bg-card/40 p-2.5"
  >
    <div class="flex items-center gap-2">
      <input
        class="w-28 rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring shrink-0"
        placeholder="v1.0.0"
        aria-label="tag name"
        bind:value={tagName}
        disabled={disabled || busy}
      />
      <input
        class="min-w-0 flex-1 rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
        placeholder="annotation (empty = lightweight)"
        aria-label="tag annotation"
        bind:value={annotation}
        disabled={disabled || busy}
      />
      <Button
        size="sm"
        class="h-7 text-xs px-3 shrink-0"
        disabled={disabled || busy || tagName.trim().length === 0}
        onclick={() => {
          onCreate(
            tagName.trim(),
            annotation.trim().length === 0 ? null : annotation,
          );
          tagName = "";
          annotation = "";
        }}
        data-testid="create-tag"
      >
        Create
      </Button>
    </div>
  </div>

  {#if tags === null}
    <p class="text-xs text-ink-faint">No tags loaded.</p>
  {:else if tags.length === 0}
    <p class="text-xs text-ink-faint italic py-1">No tags.</p>
  {:else}
    <ul
      class="flex max-h-60 flex-col gap-1.5 overflow-y-auto pr-0.5"
      data-testid="tag-list"
    >
      {#each tags as tag (tag.name)}
        <li
          class="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-card/60 p-2 hover:border-border hover:bg-accent/30 transition-all"
        >
          <div class="flex items-center gap-2 min-w-0">
            <Tag class="size-3.5 text-tag shrink-0" />
            <span
              class="min-w-0 truncate font-mono text-xs font-semibold text-foreground"
              title={tag.name}
            >
              {tag.name}
            </span>
            <Badge
              tone={tag.annotated ? "tag" : "muted"}
              class="text-[10px] h-4.5 px-1.5 shrink-0"
            >
              {tag.annotated ? "annotated" : "lightweight"}
            </Badge>
          </div>

          <div class="flex items-center gap-1.5 shrink-0">
            {#if remoteName !== null && !tag.name.startsWith("refs/")}
              <Button
                size="sm"
                variant="outline"
                class="h-6 text-xs px-2 shadow-none"
                disabled={disabled || busy}
                onclick={() => onPush(tag.name)}
                data-testid={`push-tag-${tag.name}`}
              >
                Push
              </Button>
            {/if}
            <ConfirmAction
              label="Delete"
              confirmLabel={`Delete ${tag.name} locally`}
              description="A remote tag is never touched."
              disabled={disabled || busy}
              {busy}
              onConfirm={() => onDelete(tag.name)}
              data-testid={`delete-tag-${tag.name}`}
            />
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if message !== null}
    <p class="text-xs text-ink-muted" data-testid="tag-message-result">
      {message}
    </p>
  {/if}
</div>
