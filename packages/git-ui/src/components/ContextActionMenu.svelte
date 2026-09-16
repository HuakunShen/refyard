<script lang="ts">
  import type { Snippet } from "svelte";
  import * as ContextMenu from "./ui/context-menu/index.js";
  import {
    compactContextActions,
    type ContextAction,
  } from "../lib/context-actions.js";

  interface Props {
    actions: readonly ContextAction[];
    children: Snippet;
    triggerClass?: string;
    contentClass?: string;
    "data-testid"?: string;
  }

  let {
    actions,
    children,
    triggerClass = "",
    contentClass = "",
    "data-testid": testId = undefined,
  }: Props = $props();

  const visibleActions = $derived(compactContextActions(actions));
</script>

<ContextMenu.Root>
  <ContextMenu.Trigger class={triggerClass}>
    {@render children()}
  </ContextMenu.Trigger>
  <ContextMenu.Content class={contentClass} data-testid={testId}>
    {#each visibleActions as action (action.id)}
      {#if action.kind === "separator"}
        <ContextMenu.Separator />
      {:else}
        <ContextMenu.Item
          disabled={action.disabled}
          variant={action.destructive ? "destructive" : "default"}
          onclick={action.onSelect}
          data-testid={testId === undefined
            ? undefined
            : `${testId}-${action.id}`}
        >
          {action.label}
        </ContextMenu.Item>
      {/if}
    {/each}
  </ContextMenu.Content>
</ContextMenu.Root>
