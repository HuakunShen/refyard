<script lang="ts">
  import { Dialog as DialogPrimitive } from "bits-ui";
  import { Button } from "../button/index.js";
  import { cn, type WithElementRef } from "../../../lib/utils.js";
  import type { HTMLAttributes } from "svelte/elements";
  import { useGitViewI18n } from "../../../lib/i18n/context.svelte.js";

  let {
    ref = $bindable(null),
    class: className,
    children,
    showCloseButton = false,
    ...restProps
  }: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
    showCloseButton?: boolean;
  } = $props();
  const { t } = useGitViewI18n();
</script>

<div
  bind:this={ref}
  data-slot="dialog-footer"
  class={cn(
    "bg-muted/50 -mx-4 -mb-4 rounded-b-xl border-t p-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
    className,
  )}
  {...restProps}
>
  {@render children?.()}
  {#if showCloseButton}
    <DialogPrimitive.Close>
      {#snippet child({ props })}
        <Button variant="outline" {...props}>{t("dialog.close")}</Button>
      {/snippet}
    </DialogPrimitive.Close>
  {/if}
</div>
