<script lang="ts">
  /**
   * Create a repository: `git init` at a destination, or clone a remote into one.
   *
   * Both operations address a **workspace** — an approved root plus a destination inside
   * it — and that shape is visible in the form rather than hidden behind it:
   *
   * - the root is a choice, not a text field. It comes from the roots the service
   *   reports, so this panel can only offer something the host will accept;
   * - the destination is *relative*, because that is what the request carries. An
   *   absolute path is refused by the contract, and a form that collected one would be
   *   collecting a value it can never send;
   * - a failure is shown as the text the host sent — Git's own diagnostic for a
   *   refusal — instead of a rewritten "could not create repository", because the
   *   reason (not empty, permission denied, no such remote) is the whole answer.
   *
   * Nothing here decides whether the operations are available: the app passes
   * `available` from `capabilities`, and an operation this build does not implement is
   * never offered.
   */
  import { Badge } from "./ui/badge/index.js";
  import { Button } from "./ui/button/index.js";
  import { cn } from "../lib/utils.js";

  export interface WorkspaceRoot {
    readonly allowedRootId: string;
    /** The root's path, for the reader to recognise; never sent to the host. */
    readonly displayPath: string;
  }

  export interface InitRequest {
    readonly allowedRootId: string;
    readonly relativeDestination: string;
    readonly initialBranch: string | null;
  }

  export interface CloneRequest {
    readonly allowedRootId: string;
    readonly relativeDestination: string;
    readonly remoteUrl: string;
    readonly initializeSubmodules: boolean;
  }

  interface Props {
    roots: readonly WorkspaceRoot[];
    /**
     * Which of the two operations this build implements, straight from `capabilities`.
     *
     * Per operation rather than one flag: a build that could clone but not init is a
     * real state (and the other way round), and offering a mode whose operation the
     * host will refuse is the lie the capability rule exists to prevent.
     */
    available: { readonly init: boolean; readonly clone: boolean };
    disabled?: boolean;
    busy?: boolean;
    /**
     * The outcome in the host's own words: a success summary, or Git's diagnostic when
     * it refused. Never a rewritten "could not create repository" — the reason is the
     * whole answer, and the panels around this one report the same way.
     */
    message?: string | null;
    onInit: (request: InitRequest) => void;
    onClone: (request: CloneRequest) => void;
    class?: string;
  }

  let {
    roots,
    available,
    disabled = false,
    busy = false,
    message = null,
    onInit,
    onClone,
    class: className = "",
  }: Props = $props();

  let mode = $state<"init" | "clone">("init");
  /** Null means "the first root the service reports", which may arrive after mount. */
  let chosenRootId = $state<string | null>(null);
  const rootId = $derived(chosenRootId ?? roots[0]?.allowedRootId ?? "");
  let destination = $state("");
  let initialBranch = $state("");
  let remoteUrl = $state("");
  let initializeSubmodules = $state(false);

  const modeAvailable = $derived(
    mode === "init" ? available.init : available.clone,
  );
  const locked = $derived(disabled || busy);
  const destinationReady = $derived(destination.trim().length > 0);
  const ready = $derived(
    !locked &&
      modeAvailable &&
      rootId.length > 0 &&
      destinationReady &&
      (mode === "init" || remoteUrl.trim().length > 0),
  );

  function submit(): void {
    if (!ready) {
      return;
    }
    if (mode === "init") {
      const branch = initialBranch.trim();
      onInit({
        allowedRootId: rootId,
        relativeDestination: destination.trim(),
        initialBranch: branch.length === 0 ? null : branch,
      });
      return;
    }
    onClone({
      allowedRootId: rootId,
      relativeDestination: destination.trim(),
      remoteUrl: remoteUrl.trim(),
      initializeSubmodules,
    });
  }
</script>

<div
  class={cn("flex flex-col gap-2", className)}
  data-testid="repository-panel"
>
  <div class="flex items-center gap-2">
    <div
      class="flex overflow-hidden rounded border border-input"
      role="group"
      aria-label="what to create"
    >
      <button
        type="button"
        class={cn(
          "px-2.5 py-1 text-xs transition-colors",
          mode === "init"
            ? "bg-brand/15 text-ink"
            : "bg-transparent text-muted-foreground hover:bg-panel-muted",
        )}
        aria-pressed={mode === "init"}
        disabled={locked || !available.init}
        onclick={() => (mode = "init")}
        data-testid="repository-mode-init"
      >
        Create new
      </button>
      <button
        type="button"
        class={cn(
          "border-l border-input px-2.5 py-1 text-xs transition-colors",
          mode === "clone"
            ? "bg-brand/15 text-ink"
            : "bg-transparent text-muted-foreground hover:bg-panel-muted",
        )}
        aria-pressed={mode === "clone"}
        disabled={locked || !available.clone}
        onclick={() => (mode = "clone")}
        data-testid="repository-mode-clone"
      >
        Clone
      </button>
    </div>
    {#if !modeAvailable}
      <Badge tone="muted">not implemented in this build</Badge>
    {/if}
  </div>

  {#if roots.length > 1}
    <select
      class="w-full rounded border border-input bg-panel px-2 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
      aria-label="approved root"
      value={rootId}
      onchange={(event) => (chosenRootId = event.currentTarget.value)}
      disabled={locked}
    >
      {#each roots as root (root.allowedRootId)}
        <option value={root.allowedRootId}>{root.displayPath}</option>
      {/each}
    </select>
  {:else if roots.length === 1}
    <!-- One root needs no dropdown, but the reader still has to see where this lands. -->
    <p
      class="truncate font-mono text-[11px] text-ink-faint"
      title={roots[0]?.displayPath ?? ""}
    >
      inside {roots[0]?.displayPath ?? ""}
    </p>
  {/if}

  <input
    class="w-full rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
    placeholder="relative/path"
    aria-label="repository destination"
    bind:value={destination}
    disabled={locked}
    data-testid="repository-destination"
  />

  {#if mode === "clone"}
    <input
      class="w-full rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
      placeholder="https://host/project.git or an approved local path"
      aria-label="remote URL"
      bind:value={remoteUrl}
      disabled={locked}
      data-testid="repository-remote-url"
    />
    <label class="flex items-center gap-2 text-xs text-muted-foreground">
      <input
        type="checkbox"
        class="size-3.5 accent-brand"
        bind:checked={initializeSubmodules}
        disabled={locked}
        data-testid="repository-submodules"
      />
      Initialise submodules
    </label>
  {:else}
    <input
      class="w-full rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-ink-faint"
      placeholder="initial branch (optional: Git's default)"
      aria-label="initial branch"
      bind:value={initialBranch}
      disabled={locked}
    />
  {/if}

  <Button
    size="sm"
    class="h-7 self-start text-xs px-3"
    disabled={!ready}
    onclick={submit}
    data-testid="repository-submit"
  >
    {mode === "init" ? "Create repository" : "Clone repository"}
  </Button>

  {#if message !== null}
    <p class="text-xs text-ink-muted" data-testid="repository-message-result">
      {message}
    </p>
  {/if}
</div>
