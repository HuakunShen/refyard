<!--
  The appearance controls themselves: accent color, workbench background, and the
  frosted-glass toggle. Pure fields with no trigger and no dialog of their own, so the
  settings sheet can lay them out under its Appearance heading without inheriting a
  second way to open a window.
-->
<script lang="ts">
  import { Button } from "./ui/button/index.js";
  import { Badge } from "./ui/badge/index.js";
  import Check from "@lucide/svelte/icons/check";
  import { cn } from "../lib/utils.js";

  interface Props {
    accent: string;
    background: string;
    glass: boolean;
    onAccentChange: (accent: string) => void;
    onBackgroundChange: (bg: string) => void;
    onGlassChange: (glass: boolean) => void;
  }

  let {
    accent,
    background,
    glass,
    onAccentChange,
    onBackgroundChange,
    onGlassChange,
  }: Props = $props();

  let customUrlInput = $state("");

  $effect(() => {
    if (
      background.startsWith("http") ||
      (background.startsWith("/") && !background.includes("backgrounds/"))
    ) {
      customUrlInput = background;
    }
  });

  const ACCENTS = [
    {
      id: "default",
      name: "Neutral",
      color: "#52525b",
      bg: "bg-zinc-600",
    },
    { id: "blue", name: "Blue", color: "#2563eb", bg: "bg-blue-600" },
    { id: "emerald", name: "Emerald", color: "#059669", bg: "bg-emerald-600" },
    { id: "violet", name: "Violet", color: "#7c3aed", bg: "bg-violet-600" },
    { id: "rose", name: "Rose", color: "#e11d48", bg: "bg-rose-600" },
    { id: "amber", name: "Amber", color: "#d97706", bg: "bg-amber-600" },
    { id: "cyan", name: "Cyan", color: "#0891b2", bg: "bg-cyan-600" },
  ];

  const PRESET_BACKGROUNDS = [
    {
      id: "none",
      title: "Solid Canvas",
      desc: "Clean minimal workbench",
      thumbnail: "bg-card border border-border",
    },
    {
      id: "/backgrounds/mountain-mist.svg",
      title: "Mountain Mist",
      desc: "Scenic misty mountains & lake",
      thumbnail: "bg-gradient-to-br from-slate-400 via-blue-300 to-sky-100",
    },
    {
      id: "/backgrounds/aurora.svg",
      title: "Dark Aurora",
      desc: "Cosmic night sky & aurora glow",
      thumbnail:
        "bg-gradient-to-br from-slate-950 via-emerald-950 to-indigo-950",
    },
  ];

  function applyCustomUrl(): void {
    const trimmed = customUrlInput.trim();
    if (trimmed.length > 0) {
      onBackgroundChange(trimmed);
      onGlassChange(true);
    }
  }
</script>

<div class="flex flex-col gap-5">
  <!-- Accent Color Selection -->
  <div class="flex flex-col gap-2">
    <span class="text-xs font-semibold uppercase tracking-wider text-ink-muted">
      Accent Color
    </span>
    <div class="grid grid-cols-3 gap-2">
      {#each ACCENTS as item (item.id)}
        {@const active = accent === item.id}
        <button
          type="button"
          onclick={() => onAccentChange(item.id)}
          class={cn(
            "flex items-center gap-2.5 rounded-lg border p-2 text-left text-xs transition-all",
            active
              ? "border-primary bg-primary/10 font-medium text-foreground shadow-xs"
              : "border-border/60 bg-card/60 hover:border-border hover:bg-accent/40 text-ink-muted",
          )}
        >
          <span
            class={cn(
              "size-3.5 rounded-full shrink-0 flex items-center justify-center text-white",
              item.bg,
            )}
          >
            {#if active}
              <Check class="size-2.5" />
            {/if}
          </span>
          <span class="truncate">{item.name}</span>
        </button>
      {/each}
    </div>
  </div>

  <!-- Wallpaper Background Selection -->
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between">
      <span
        class="text-xs font-semibold uppercase tracking-wider text-ink-muted"
      >
        Workbench Background
      </span>
      {#if background !== "none"}
        <Badge tone="branch" class="text-[10px]">Active</Badge>
      {/if}
    </div>

    <div class="grid grid-cols-3 gap-2">
      {#each PRESET_BACKGROUNDS as preset (preset.id)}
        {@const active = background === preset.id}
        <button
          type="button"
          onclick={() => {
            onBackgroundChange(preset.id);
            if (preset.id !== "none") {
              onGlassChange(true);
            }
          }}
          class={cn(
            "group relative flex flex-col items-start gap-1.5 rounded-lg border p-2 text-left transition-all overflow-hidden",
            active
              ? "border-primary bg-primary/10 shadow-xs"
              : "border-border/60 bg-card/60 hover:border-border hover:bg-accent/40",
          )}
        >
          <div
            class={cn(
              "h-12 w-full rounded-md shadow-inner transition-transform group-hover:scale-[1.02]",
              preset.thumbnail,
            )}
          ></div>
          <span class="text-xs font-medium text-foreground truncate w-full">
            {preset.title}
          </span>
          <span class="text-[10px] text-ink-faint leading-tight line-clamp-1">
            {preset.desc}
          </span>
        </button>
      {/each}
    </div>

    <!-- Custom Wallpaper URL -->
    <div class="mt-1 flex items-center gap-2">
      <input
        class="min-w-0 flex-1 rounded-md border border-input bg-transparent px-2.5 py-1 text-xs font-mono placeholder:text-ink-faint"
        placeholder="Custom image URL (https://...)"
        aria-label="Custom background URL"
        bind:value={customUrlInput}
        onkeydown={(e) => {
          if (e.key === "Enter") {
            applyCustomUrl();
          }
        }}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={customUrlInput.trim().length === 0}
        onclick={applyCustomUrl}
      >
        Apply URL
      </Button>
      {#if background !== "none"}
        <Button
          size="sm"
          variant="ghost"
          onclick={() => {
            onBackgroundChange("none");
            onGlassChange(false);
            customUrlInput = "";
          }}
        >
          Clear
        </Button>
      {/if}
    </div>
  </div>

  <!-- Frosted Glass Toggle -->
  <div
    class="flex items-center justify-between rounded-lg border border-border/60 bg-card/50 p-3"
  >
    <div class="flex flex-col gap-0.5">
      <span class="text-xs font-medium text-foreground"
        >Frosted Glass Effect</span
      >
      <span class="text-[11px] text-ink-faint">
        Translucent backdrop blur on cards and panels for wallpapers
      </span>
    </div>
    <label class="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={glass}
        onchange={(e) => onGlassChange(e.currentTarget.checked)}
        class="sr-only peer"
        aria-label="Toggle frosted glass"
      />
      <div
        class="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"
      ></div>
    </label>
  </div>
</div>
