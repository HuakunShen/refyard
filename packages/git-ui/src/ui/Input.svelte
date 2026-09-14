<script lang="ts">
  /**
   * A text input with a value/oninput pair rather than a two-way binding.
   *
   * The components in this package are driven by their props; `bind:value` into a
   * parent's state would make every field a second source of truth and make the
   * connection form impossible to test without a DOM.
   */
  import { cn } from "../lib/utils.js";

  interface Props {
    value: string;
    id?: string;
    label?: string;
    hint?: string;
    placeholder?: string;
    type?: "text" | "password" | "url";
    disabled?: boolean;
    monospace?: boolean;
    class?: string;
    oninput?: (value: string) => void;
    /** Called when Enter is pressed, so a form can submit without a submit button. */
    onsubmit?: () => void;
  }

  let {
    value,
    id,
    label,
    hint,
    placeholder = "",
    type = "text",
    disabled = false,
    monospace = false,
    class: className = "",
    oninput,
    onsubmit,
  }: Props = $props();
</script>

<div class={cn("flex flex-col gap-1", className)}>
  {#if label !== undefined}
    {#if id !== undefined}
      <label class="text-xs font-medium text-ink-muted" for={id}>{label}</label>
    {:else}
      <span class="text-xs font-medium text-ink-muted">{label}</span>
    {/if}
  {/if}
  <input
    {id}
    {type}
    {disabled}
    {placeholder}
    {value}
    spellcheck="false"
    autocomplete="off"
    oninput={(event) => oninput?.(event.currentTarget.value)}
    onkeydown={(event) => {
      if (event.key === "Enter") {
        onsubmit?.();
      }
    }}
    class={cn(
      "h-9 w-full rounded-md border border-border bg-panel px-2.5 text-sm text-ink",
      "placeholder:text-ink-faint",
      "focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent/40",
      "disabled:opacity-50",
      monospace && "font-mono text-xs",
    )}
  />
  {#if hint !== undefined}
    <p class="text-xs text-ink-faint">{hint}</p>
  {/if}
</div>
