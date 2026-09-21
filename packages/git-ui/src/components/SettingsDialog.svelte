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
  import {
    stepUpdates,
    type UpdatesPhase,
    type UpdatesProbe,
  } from "../lib/updates.js";
  import type { RowDensity } from "../lib/geometry.js";

  interface SettingsAbout {
    /** The app shell's own version, when the runtime knows one (desktop via Tauri). */
    appVersion?: string;
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
    avatars?: boolean;
    density?: RowDensity;
    onAccentChange: (accent: string) => void;
    onBackgroundChange: (bg: string) => void;
    onGlassChange: (glass: boolean) => void;
    onAvatarsChange?: (avatars: boolean) => void;
    onDensityChange?: (density: RowDensity) => void;
    about?: SettingsAbout;
    onDisconnect?: () => void;
    /** Present only where updates can exist: the desktop runtime. */
    updates?: UpdatesProbe;
    autoCheck?: boolean;
    onAutoCheckChange?: (enabled: boolean) => void;
  }

  let {
    accent,
    background,
    glass,
    avatars = true,
    density = "roomy",
    onAccentChange,
    onBackgroundChange,
    onGlassChange,
    onAvatarsChange = undefined,
    onDensityChange = undefined,
    about,
    onDisconnect,
    updates,
    autoCheck = false,
    onAutoCheckChange = undefined,
  }: Props = $props();

  let open = $state(false);
  let updatesPhase = $state<UpdatesPhase>({ state: "idle" });

  // Template-side views of the phase: Svelte's template narrowing does not look through
  // the discriminated union, so the answers are computed once, here.
  const availableUpdate = $derived(
    updatesPhase.state === "available"
      ? { offer: updatesPhase.offer, version: updatesPhase.version }
      : null,
  );
  const readyOffer = $derived(
    updatesPhase.state === "ready" ? updatesPhase.offer : null,
  );
  const updatesBusy = $derived(
    updatesPhase.state === "checking" || updatesPhase.state === "installing",
  );
  const updatesMessage = $derived(
    updatesPhase.state === "error" ? updatesPhase.message : "",
  );

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

  async function runUpdatesStep(): Promise<void> {
    if (updates === undefined) return;
    updatesPhase = await stepUpdates(updatesPhase, updates);
  }

  // The platform's settings shortcut (Cmd+, on macOS, Ctrl+, elsewhere). The dialog owns
  // the binding because it owns `open`; nothing else needs to know it exists. The key
  // carries a modifier, so it can never collide with typing into a field.
  $effect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        event.key === ","
      ) {
        event.preventDefault();
        open = true;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const ABOUT_ROWS = $derived(
    [
      about?.appVersion === undefined
        ? undefined
        : { label: "Version", value: about.appVersion },
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
          {avatars}
          {density}
          {onAccentChange}
          {onBackgroundChange}
          {onGlassChange}
          {onAvatarsChange}
          {onDensityChange}
        />
      </section>

      {#if updates !== undefined}
        <section class="flex flex-col gap-3" data-testid="settings-updates">
          <h3
            class="text-xs font-semibold uppercase tracking-wider text-ink-muted"
          >
            Updates
          </h3>
          <div class="flex items-center gap-2">
            {#if updatesBusy}
              <Button
                size="sm"
                variant="outline"
                disabled
                data-testid="updates-busy"
              >
                {updatesPhase.state === "checking"
                  ? "Checking…"
                  : "Downloading and installing…"}
              </Button>
            {:else if availableUpdate !== null}
              <Button
                size="sm"
                onclick={() => void runUpdatesStep()}
                data-testid="updates-install"
              >
                Download and install
                {availableUpdate.version === null
                  ? ""
                  : `v${availableUpdate.version}`}
              </Button>
            {:else if readyOffer !== null}
              <Button
                size="sm"
                onclick={() => void readyOffer.relaunch()}
                data-testid="updates-restart"
              >
                Restart to finish
              </Button>
            {:else}
              <Button
                size="sm"
                variant="outline"
                onclick={() => void runUpdatesStep()}
                data-testid="updates-check"
              >
                Check for updates
              </Button>
            {/if}
            {#if updatesPhase.state === "up-to-date"}
              <span
                class="text-xs text-muted-foreground"
                data-testid="updates-up-to-date"
              >
                Refyard is up to date.
              </span>
            {/if}
            {#if updatesMessage.length > 0}
              <span class="text-xs text-danger" data-testid="updates-error">
                {updatesMessage}
              </span>
            {/if}
          </div>
          {#if onAutoCheckChange !== undefined}
            <label class="flex items-center gap-2 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={autoCheck}
                onchange={(event) =>
                  onAutoCheckChange(event.currentTarget.checked)}
                data-testid="updates-auto-check"
              />
              Check automatically when the app starts
            </label>
          {/if}
        </section>
      {/if}

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
