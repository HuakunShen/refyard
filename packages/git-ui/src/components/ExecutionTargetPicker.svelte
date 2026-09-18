<script lang="ts">
  /**
   * Where Git runs: this machine, or a host the user's own SSH configuration names.
   *
   * The picker reports a name and nothing else — it never connects and never creates
   * a target; that step belongs to the caller, which owns the SSH provider and its
   * trust policy. Opening it reads exactly what `loadTargetOptions` reads (the host's
   * capabilities and its SSH host list) and every open starts on Local, so a host
   * chosen in an earlier visit is never reselected or contacted by default.
   */
  import { untrack } from "svelte";
  import { Laptop, Search, Server, TriangleAlert } from "@lucide/svelte";
  import type {
    ExecutionTargetOption,
    ExecutionTargetSelection,
    TargetOptionsLoad,
  } from "../lib/execution-targets.js";
  import {
    filterTargetOptions,
    localTargetOption,
    manualAliasOfferable,
    manualAliasSelection,
    selectionForOption,
    targetOptionsFromList,
  } from "../lib/execution-targets.js";
  import { Badge } from "./ui/badge/index.js";
  import { Button } from "./ui/button/index.js";
  import { Input } from "./ui/input/index.js";
  import * as Dialog from "./ui/dialog/index.js";
  import { cn } from "../lib/utils.js";

  interface Props {
    open?: boolean;
    /**
     * The two-read load, injected rather than imported: the package must not know how
     * the app connects. Callers pass `loadTargetOptions` bound to their host service.
     */
    loadOptions: () => Promise<TargetOptionsLoad>;
    onSelectTarget: (selection: ExecutionTargetSelection) => void;
  }

  let {
    open = $bindable(false),
    loadOptions,
    onSelectTarget,
  }: Props = $props();

  let load = $state<TargetOptionsLoad | null>(null);
  let query = $state("");
  let aliasDraft = $state("");
  let searchElement = $state<HTMLInputElement | null>(null);
  /** Keyboard-highlighted row; Local is index 0 in every list this picker builds. */
  let activeIndex = $state(0);
  let loadSequence = 0;

  const options = $derived(
    load?.kind === "ready"
      ? targetOptionsFromList(load.hosts)
      : [localTargetOption()],
  );
  const visible = $derived(filterTargetOptions(options, query));
  const notice = $derived(load?.kind === "ready" ? load.notice : null);
  const unavailable = $derived(load?.kind === "unavailable" ? load : null);
  const manualOffer = $derived(load !== null && manualAliasOfferable(load));
  const manualSelection = $derived(manualAliasSelection(aliasDraft));

  async function refresh(): Promise<void> {
    const sequence = ++loadSequence;
    query = "";
    aliasDraft = "";
    activeIndex = 0;
    load = null;
    const result = await loadOptions();
    // A newer open may have started while this read was in flight; the newer read owns
    // the dialog, so an older answer must not overwrite it.
    if (sequence !== loadSequence) return;
    load = result;
  }

  $effect(() => {
    if (!open) return;
    // The effect is about the open edge only; the load itself reads a prop, and
    // tracking that would reload whenever the caller re-creates its callback.
    untrack(() => {
      void refresh();
    });
  });

  $effect(() => {
    // The search box is the first thing the eye lands on; focusing it after the read
    // finishes keeps typing immediate without an `autofocus` that would fire while
    // the dialog is still hidden.
    if (open && load !== null) searchElement?.focus();
  });

  function choose(option: ExecutionTargetOption): void {
    onSelectTarget(selectionForOption(option));
    open = false;
  }

  function chooseManual(): void {
    if (manualSelection === null) return;
    onSelectTarget(manualSelection);
    open = false;
  }

  function moveActive(delta: number): void {
    const count = visible.length;
    if (count === 0) return;
    activeIndex = (activeIndex + delta + count) % count;
  }

  function handleSearchKeydown(event: KeyboardEvent): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
      return;
    }
    if (event.key === "Enter") {
      const option = visible[activeIndex];
      if (option === undefined) return;
      event.preventDefault();
      choose(option);
    }
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="max-w-2xl" data-testid="execution-target-picker">
    <Dialog.Header>
      <Dialog.Title>Where should Git run?</Dialog.Title>
      <Dialog.Description>
        This machine, or a host your SSH configuration names. Choosing a host
        only selects it; nothing is contacted until you open a repository there.
      </Dialog.Description>
    </Dialog.Header>

    <label class="relative block" for="execution-target-search">
      <Search
        class="pointer-events-none absolute left-2.5 top-2.5 size-3.5 text-muted-foreground"
      />
      <Input
        id="execution-target-search"
        class="pl-8 text-sm"
        placeholder="Search hosts by name, label or source"
        bind:ref={searchElement}
        bind:value={query}
        oninput={() => (activeIndex = 0)}
        onkeydown={handleSearchKeydown}
        disabled={load === null}
        data-testid="execution-target-search"
      />
    </label>

    {#if unavailable !== null}
      <p
        class="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
        data-testid="execution-target-unavailable"
      >
        The SSH host list is unavailable: {unavailable.message}
      </p>
    {/if}

    {#if notice !== null}
      <div
        class="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-xs"
        data-testid="execution-target-notice"
      >
        <p class="flex items-start gap-2 font-medium text-warn">
          <TriangleAlert class="mt-px size-3.5 shrink-0" />
          <span>{notice.summary}</span>
        </p>
        {#if notice.warnings.length > 0}
          <ul class="mt-1 list-disc pl-6 text-muted-foreground">
            {#each notice.warnings as warning}
              <li>{warning}</li>
            {/each}
          </ul>
        {/if}
      </div>
    {/if}

    {#if manualOffer}
      <form
        class="flex items-end gap-2 rounded-md border border-border bg-muted/30 p-3"
        data-testid="execution-target-manual"
        onsubmit={(event) => {
          event.preventDefault();
          chooseManual();
        }}
      >
        <label
          class="min-w-0 flex-1 text-xs font-medium"
          for="execution-target-manual-alias"
          >Enter a host alias from your SSH configuration
          <Input
            id="execution-target-manual-alias"
            class="mt-1 font-mono text-xs"
            placeholder="e.g. production-jump"
            bind:value={aliasDraft}
            data-testid="execution-target-manual-alias"
          />
        </label>
        <Button
          type="submit"
          variant="outline"
          disabled={manualSelection === null}
          data-testid="execution-target-manual-submit">Use alias</Button
        >
      </form>
    {/if}

    {#if load === null}
      <p class="p-6 text-center text-xs text-muted-foreground">
        Reading the host's SSH configuration…
      </p>
    {:else if visible.length === 0}
      <p
        class="p-6 text-center text-xs text-muted-foreground"
        data-testid="execution-target-empty"
      >
        {unavailable === null
          ? "No target matches this search."
          : "No host matches this search; this machine is still available."}
      </p>
    {/if}

    {#if load !== null && visible.length > 0}
      <div
        class="max-h-80 overflow-y-auto rounded-md border border-border"
        data-testid="execution-target-options"
      >
        {#each visible as option, index (option.optionId)}
          <button
            type="button"
            class={cn(
              "flex w-full items-start gap-3 border-b border-border/60 px-3 py-2 text-left last:border-b-0 hover:bg-muted/50",
              index === activeIndex && "bg-muted/50",
            )}
            onclick={() => choose(option)}
            data-testid={`execution-target-option-${option.optionId}`}
          >
            {#if option.kind === "local"}
              <Laptop class="mt-0.5 size-4 shrink-0 text-primary" />
            {:else}
              <Server class="mt-0.5 size-4 shrink-0 text-primary" />
            {/if}
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">
                {option.kind === "local" ? option.label : option.alias}
              </span>
              <span class="block truncate text-[11px] text-muted-foreground">
                {option.kind === "local"
                  ? option.description
                  : `${option.label} · ${option.sourceId}`}
              </span>
            </span>
            {#if option.kind === "ssh-config" && option.discoveryIncomplete}
              <Badge tone="warn">incomplete</Badge>
            {/if}
          </button>
        {/each}
      </div>
    {/if}

    <Dialog.Footer>
      <span class="flex-1 text-xs text-muted-foreground">
        Reading configuration never contacts a host.
      </span>
      <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
