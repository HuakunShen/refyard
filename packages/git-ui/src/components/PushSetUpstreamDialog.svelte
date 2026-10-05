<script lang="ts">
  import { m } from "../i18n.js";
  /**
   * Confirm where an upstream-less branch should push and pull from.
   *
   * A local-only branch disables the plain push — there is no destination to name —
   * so pushing it starts here instead: pick the remote, keep or edit the branch name,
   * and the push sets upstream tracking in the same move, which is what makes the
   * ordinary push/pull buttons work afterwards. Nothing is forced; the remote list is
   * the repository's own remotes.
   */
  import { Button } from "./ui/button/index.js";
  import * as Dialog from "./ui/dialog/index.js";

  interface Props {
    open?: boolean;
    /** The branch that has no upstream yet; names the question and prefills the field. */
    branchName: string | null;
    /** The repository's remote names, in refs order. */
    remotes: readonly string[];
    busy?: boolean;
    onSubmit: (remoteName: string, branchName: string) => void;
    "data-testid"?: string;
  }

  let {
    open = $bindable(false),
    branchName = null,
    remotes = [],
    busy = false,
    onSubmit,
    "data-testid": testId = undefined,
  }: Props = $props();

  let remoteName = $state("");
  let destinationBranch = $state("");

  /** Re-seed the form each time the dialog opens, so a stale edit never outlives it. */
  $effect(() => {
    if (!open) return;
    remoteName = remotes.includes("origin")
      ? "origin"
      : (remotes[0] ?? "");
    destinationBranch = branchName ?? "";
  });

  const submitDisabled = $derived(
    busy || remoteName.length === 0 || destinationBranch.trim().length === 0,
  );

  function submit(): void {
    if (submitDisabled) return;
    const branch = destinationBranch.trim();
    open = false;
    onSubmit(remoteName, branch);
  }
</script>

<Dialog.Root bind:open>
  <Dialog.Content
    class="max-w-[440px]"
    data-testid={testId === undefined ? "push-upstream-dialog" : testId}
  >
    <Dialog.Header>
      <Dialog.Title class="text-sm font-semibold">
        {m.push_upstream_title({ branch: branchName ?? "" })}
      </Dialog.Title>
    </Dialog.Header>
    <form
      class="flex flex-col gap-3"
      onsubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div class="flex items-end gap-2">
        <label class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="text-xs text-ink-muted">{m.push_upstream_remote_label()}</span>
          <select
            class="min-w-0 rounded border border-input bg-background px-2 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
            bind:value={remoteName}
            data-testid="push-upstream-remote"
          >
            {#each remotes as name (name)}
              <option value={name}>{name}</option>
            {/each}
          </select>
        </label>
        <span class="pb-1.5 text-ink-faint">/</span>
        <label class="flex min-w-0 flex-1 flex-col gap-1">
          <span class="text-xs text-ink-muted">{m.push_upstream_branch_label()}</span>
          <input
            class="min-w-0 rounded border border-input bg-background px-2 py-1 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
            bind:value={destinationBranch}
            data-testid="push-upstream-branch"
          />
        </label>
      </div>
      <p class="text-xs text-ink-faint">{m.push_upstream_note()}</p>
      <div class="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onclick={() => (open = false)}
          data-testid="push-upstream-cancel"
        >
          {m.common_cancel()}
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={submitDisabled}
          data-testid="push-upstream-submit"
        >
          {m.push_upstream_submit()}
        </Button>
      </div>
    </form>
  </Dialog.Content>
</Dialog.Root>
