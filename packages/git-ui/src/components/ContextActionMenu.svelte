<script lang="ts">
  /** Renders shared context actions on a single trigger with disabled explanations. */
  import type { Snippet } from "svelte";
  import * as ContextMenu from "./ui/context-menu/index.js";
  import {
    compactContextActions,
    contextActionDisabled,
    type ContextAction,
  } from "../lib/context-actions.js";

  interface Props {
    actions: readonly ContextAction[];
    children: Snippet;
    triggerClass?: string;
    triggerTestId?: string;
    contentClass?: string;
    "data-testid"?: string;
  }

  let {
    actions,
    children,
    triggerClass = "",
    triggerTestId = undefined,
    contentClass = "",
    "data-testid": testId = undefined,
  }: Props = $props();

  const visibleActions = $derived(compactContextActions(actions));
</script>

<ContextMenu.Root>
  <ContextMenu.Trigger class={triggerClass} data-testid={triggerTestId}>
    {@render children()}
  </ContextMenu.Trigger>
  <ContextMenu.Content class={contentClass} data-testid={testId}>
    {#each visibleActions as action (action.id)}
      {#if action.kind === "separator"}
        <ContextMenu.Separator />
      {:else}
        <ContextMenu.Item
          disabled={contextActionDisabled(action)}
          variant={action.destructive ? "destructive" : "default"}
          onclick={() => {
            if (!contextActionDisabled(action)) action.onSelect();
          }}
          data-testid={testId === undefined
            ? undefined
            : `${testId}-${action.id}`}
        >
          <span class="min-w-0">
            <span class="block">{action.label}</span>
            {#if contextActionDisabled(action) && action.disabledReason !== undefined}
              <span
                class="block whitespace-normal text-xs text-muted-foreground"
                >{action.disabledReason}</span
              >
            {/if}
          </span>
        </ContextMenu.Item>
      {/if}
    {/each}
  </ContextMenu.Content>
</ContextMenu.Root>
