<script lang="ts">
  /** Top-level repository tabs; one tab is active while the session may keep many open. */
  import { Laptop, Plus, Server, X } from "@lucide/svelte";
  import { cn } from "../lib/utils.js";
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";

  export interface RepositoryTabItem {
    readonly repositoryId: string;
    readonly displayName: string;
    readonly displayPath: string;
    /**
     * The machine this tab's Git runs on, when the host names one: `targetKind` says
     * whether the label names this machine or a remote host.
     * Without any of this, two tabs for the same path on different machines would look
     * identical, which is exactly the confusion the tab bar must not create.
     */
    readonly targetLabel?: string | null;
    readonly targetKind?: "local" | "remote";
  }

  interface Props {
    tabs: readonly RepositoryTabItem[];
    activeRepositoryId: string | null;
    onSelect: (repositoryId: string) => void;
    onClose: (repositoryId: string) => void;
    onNew: () => void;
    disabled?: boolean;
  }

  let {
    tabs,
    activeRepositoryId,
    onSelect,
    onClose,
    onNew,
    disabled = false,
  }: Props = $props();
  const { t } = useGitViewI18n();
</script>

<!--
  Inert in a plain browser; in the desktop shell the strip this fills is the window's
  drag region, and Tauri only drags when the exact mousedown target carries the
  attribute — so the row's empty stretches must carry it themselves. The tabs' own
  buttons stay interactive because the target is then the button.
-->
<div
  class="flex w-full min-w-0 items-center gap-1 overflow-x-auto"
  data-testid="repository-tabs"
  data-tauri-drag-region
>
  {#each tabs as tab (tab.repositoryId)}
    <div
      class={cn(
        "group flex min-w-32 max-w-52 items-center gap-1 rounded-md border px-2 py-1 text-xs",
        tab.repositoryId === activeRepositoryId
          ? "border-primary/40 bg-primary/10 text-foreground"
          : "border-transparent bg-muted/40 text-muted-foreground hover:bg-muted",
      )}
      data-testid={`repository-tab-${tab.repositoryId}`}
    >
      <button
        type="button"
        {disabled}
        class="flex min-w-0 flex-1 items-center gap-1 text-left font-medium"
        title={tab.displayPath}
        aria-label={tab.targetLabel == null
          ? tab.displayName
          : `${tab.displayName} — ${t("repository.tab.target").replace("{name}", () => tab.targetLabel ?? "")}`}
        aria-current={tab.repositoryId === activeRepositoryId
          ? "page"
          : undefined}
        onclick={() => onSelect(tab.repositoryId)}
      >
        <span class="min-w-0 truncate">{tab.displayName}</span>
        {#if tab.targetLabel !== undefined && tab.targetLabel !== null}
          <!--
            The machine, inside the tab's own button so a click on it selects the tab:
            this machine gets an icon alone, a named host keeps its label, because the
            two answers a tab can carry are "here" and "there".
          -->
          <span
            class="flex shrink-0 items-center gap-0.5 rounded bg-background/70 px-1 py-px text-[10px] font-normal text-muted-foreground"
            title={t("repository.tab.target").replace(
              "{name}",
              () => tab.targetLabel ?? "",
            )}
            data-testid={`repository-target-${tab.repositoryId}`}
          >
            {#if tab.targetKind === "remote"}
              <Server class="size-2.5 shrink-0" />
              <span class="max-w-20 truncate">{tab.targetLabel}</span>
            {:else}
              <Laptop class="size-2.5 shrink-0" />
            {/if}
          </span>
        {/if}
      </button>
      <button
        type="button"
        {disabled}
        class="rounded p-0.5 text-muted-foreground opacity-70 hover:bg-background hover:text-foreground group-hover:opacity-100"
        aria-label={t("repository.tab.close").replace(
          "{name}",
          () => tab.displayName,
        )}
        onclick={() => onClose(tab.repositoryId)}
      >
        <X class="size-3" />
      </button>
    </div>
  {/each}
  <button
    type="button"
    class="flex shrink-0 items-center gap-1 rounded-md border border-dashed border-border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
    {disabled}
    aria-label={t("repository.tab.new")}
    data-testid="new-repository-tab"
    onclick={onNew}
  >
    <Plus class="size-3" />
    {t("repository.tab.newShort")}
  </button>
</div>
