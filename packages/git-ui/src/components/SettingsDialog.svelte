<!--
  The workbench settings sheet, reached from one gear in the top strip's corner. The
  bar itself carries nothing but the gear: appearance lives here (light/dark/system,
  accent, background, glass), and so does the machine-facing detail — git version,
  service instance, backend label, write operations — that used to spend header space
  every day to answer a question asked roughly never.
-->
<script lang="ts">
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
  } from "./ui/dialog/index.js";
  import { Button } from "./ui/button/index.js";
  import SettingsIcon from "@lucide/svelte/icons/settings";
  import SunIcon from "@lucide/svelte/icons/sun";
  import MoonIcon from "@lucide/svelte/icons/moon";
  import MonitorIcon from "@lucide/svelte/icons/monitor";
  import Sparkles from "@lucide/svelte/icons/sparkles";
  import { resetMode, setMode, mode } from "mode-watcher";
  import { buttonVariants } from "./ui/button/index.js";
  import { cn } from "../lib/utils.js";
  import AppearanceFields from "./AppearanceFields.svelte";
  import RefyardLogo from "./RefyardLogo.svelte";

  interface SettingsAbout {
    gitVersion?: string;
    serviceInstanceId?: string;
    backendLabel?: string;
    /** How many write operations the connected service implements; 0 means read-only. */
    operations?: number;
  }

  interface Props {
    accent: string;
    background: string;
    glass: boolean;
    onAccentChange: (accent: string) => void;
    onBackgroundChange: (bg: string) => void;
    onGlassChange: (glass: boolean) => void;
    about?: SettingsAbout;
    onDisconnect?: () => void;
  }

  let {
    accent,
    background,
    glass,
    onAccentChange,
    onBackgroundChange,
    onGlassChange,
    about,
    onDisconnect,
  }: Props = $props();

  let open = $state(false);

  /** `mode.current` is undefined while the choice is the system's own — the answer resetMode gives back. */
  const activeMode = $derived(mode.current ?? "system");

  const MODE_OPTIONS = [
    {
      id: "light",
      label: "Light",
      icon: SunIcon,
      pick: () => setMode("light"),
    },
    { id: "dark", label: "Dark", icon: MoonIcon, pick: () => setMode("dark") },
    { id: "system", label: "System", icon: MonitorIcon, pick: resetMode },
  ] as const;

  const ABOUT_ROWS = $derived(
    [
      about?.gitVersion === undefined
        ? undefined
        : { label: "Git", value: about.gitVersion },
      about?.serviceInstanceId === undefined
        ? undefined
        : { label: "Service instance", value: about.serviceInstanceId },
      about?.backendLabel === undefined
        ? undefined
        : { label: "Backend", value: about.backendLabel },
      about?.operations === undefined
        ? undefined
        : {
            label: "Write operations",
            value:
              about.operations === 0
                ? "none — read-only build"
                : String(about.operations),
          },
    ].filter((row) => row !== undefined),
  );
</script>

<Dialog bind:open>
  <DialogTrigger>
    {#snippet child({ props })}
      <Button
        {...props}
        size="icon"
        variant="ghost"
        class="size-7"
        title="Settings"
        aria-label="Settings"
        data-testid="settings-open"
      >
        <SettingsIcon class="size-4" />
      </Button>
    {/snippet}
  </DialogTrigger>

  <DialogContent
    class="sm:max-w-[500px] border-border/80 bg-panel/95 backdrop-blur-xl"
  >
    <DialogHeader>
      <DialogTitle class="flex items-center gap-2 text-base font-semibold">
        <Sparkles class="size-4 text-primary" />
        Settings
      </DialogTitle>
      <DialogDescription class="text-xs text-ink-muted">
        Appearance and connection details. Preferences are saved locally.
      </DialogDescription>
    </DialogHeader>

    <div class="flex flex-col gap-6 py-2">
      <section class="flex flex-col gap-3" data-testid="settings-appearance">
        <h3
          class="text-xs font-semibold uppercase tracking-wider text-ink-muted"
        >
          Appearance
        </h3>
        <div
          class="flex items-center gap-1 self-start rounded-lg border border-border/60 bg-card/60 p-1"
        >
          {#each MODE_OPTIONS as option (option.id)}
            {@const active = activeMode === option.id}
            <button
              type="button"
              onclick={option.pick}
              aria-pressed={active}
              class={cn(
                buttonVariants({ variant: "ghost", size: "sm" }),
                "gap-1.5 text-xs",
                active
                  ? "bg-accent/60 font-medium text-foreground"
                  : "text-ink-muted hover:text-ink",
              )}
            >
              <option.icon class="size-3.5" />
              {option.label}
            </button>
          {/each}
        </div>
        <AppearanceFields
          {accent}
          {background}
          {glass}
          {onAccentChange}
          {onBackgroundChange}
          {onGlassChange}
        />
      </section>

      {#if ABOUT_ROWS.length > 0 || onDisconnect !== undefined}
        <section class="flex flex-col gap-2" data-testid="settings-about">
          <h3
            class="text-xs font-semibold uppercase tracking-wider text-ink-muted"
          >
            About & connection
          </h3>
          <div
            class="flex flex-col gap-1 rounded-lg border border-border/60 bg-card/50 p-3"
          >
            <div class="flex items-center gap-2 pb-1">
              <RefyardLogo variant="mark" size={18} />
              <span class="text-xs font-semibold">refyard</span>
            </div>
            {#each ABOUT_ROWS as row (row.label)}
              <div class="flex items-baseline justify-between gap-3 text-xs">
                <span class="text-ink-faint">{row.label}</span>
                <span
                  class="min-w-0 truncate text-right font-mono text-ink-muted"
                  >{row.value}</span
                >
              </div>
            {/each}
          </div>
          {#if onDisconnect !== undefined}
            <Button size="sm" variant="outline" onclick={onDisconnect}
              >Disconnect</Button
            >
          {/if}
        </section>
      {/if}
    </div>
  </DialogContent>
</Dialog>
