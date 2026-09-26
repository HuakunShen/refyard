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
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";

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
     *
     * `"unknown"` is the third answer, and it is not the same one: capabilities that
     * never arrived — the service is gone, or has not answered yet — say nothing about
     * this build. Saying "not implemented in this build" there would blame the code for
     * a connection the reader could restore.
     */
    available: { readonly init: boolean; readonly clone: boolean } | "unknown";
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
  const { t } = useGitViewI18n();

  let mode = $state<"init" | "clone">("init");
  /** Null means "the first root the service reports", which may arrive after mount. */
  let chosenRootId = $state<string | null>(null);
  const rootId = $derived(chosenRootId ?? roots[0]?.allowedRootId ?? "");
  let destination = $state("");
  let initialBranch = $state("");
  let remoteUrl = $state("");
  let initializeSubmodules = $state(false);

  const initAvailable = $derived(
    available === "unknown" ? false : available.init,
  );
  const cloneAvailable = $derived(
    available === "unknown" ? false : available.clone,
  );
  const modeAvailable = $derived(mode === "init" ? initAvailable : cloneAvailable);
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
      aria-label={t("repository.create.what")}
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
        disabled={locked || !initAvailable}
        onclick={() => (mode = "init")}
        data-testid="repository-mode-init"
      >
        {t("repository.create.new")}
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
        disabled={locked || !cloneAvailable}
        onclick={() => (mode = "clone")}
        data-testid="repository-mode-clone"
      >
        {t("repository.create.clone")}
      </button>
    </div>
    {#if available === "unknown"}
      <Badge tone="muted">{t("repository.create.operationsUnknown")}</Badge>
    {:else if !modeAvailable}
      <Badge tone="muted">{t("repository.create.notImplemented")}</Badge>
    {/if}
  </div>

  {#if roots.length > 1}
    <select
      class="w-full rounded border border-input bg-panel px-2 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
      aria-label={t("repository.create.approvedRoot")}
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
      {t("repository.create.inside")} {roots[0]?.displayPath ?? ""}
    </p>
  {/if}

  <input
    class="w-full rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
    placeholder={t("repository.create.relativePath")}
    aria-label={t("repository.create.destination")}
    bind:value={destination}
    disabled={locked}
    data-testid="repository-destination"
  />

  {#if mode === "clone"}
    <input
      class="w-full rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
      placeholder={t("repository.create.remotePlaceholder")}
      aria-label={t("repository.create.remoteUrl")}
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
      {t("repository.create.submodules")}
    </label>
  {:else}
    <input
      class="w-full rounded border border-input bg-transparent px-2.5 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring placeholder:text-ink-faint"
      placeholder={t("repository.create.branchPlaceholder")}
      aria-label={t("repository.create.initialBranch")}
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
    {t(mode === "init" ? "repository.create.confirmInit" : "repository.create.confirmClone")}
  </Button>

  {#if message !== null}
    <p class="text-xs text-ink-muted" data-testid="repository-message-result">
      {message}
    </p>
  {/if}
</div>
