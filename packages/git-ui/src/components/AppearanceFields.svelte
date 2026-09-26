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
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";
  import {
    densityMetrics,
    ROW_DENSITIES,
    type RowDensity,
  } from "../lib/geometry.js";
  import { m, type UiLanguage } from "../i18n.js";

  /** Name the choices in the active locale, including after the root remounts on change. */
  function languageChoices(): readonly {
    readonly id: UiLanguage;
    readonly label: string;
  }[] {
    return [
      { id: "auto", label: m.settings_language_auto() },
      { id: "en", label: m.settings_language_en() },
      { id: "zh", label: m.settings_language_zh() },
    ];
  }

  interface Props {
    accent: string;
    background: string;
    glass: boolean;
    avatars: boolean;
    density: RowDensity;
    /** The reader's language preference; `auto` follows the browser. */
    language: UiLanguage;
    onAccentChange: (accent: string) => void;
    onLanguageChange?: (language: UiLanguage) => void;
    onBackgroundChange: (bg: string) => void;
    onGlassChange: (glass: boolean) => void;
    onAvatarsChange?: (avatars: boolean) => void;
    onDensityChange?: (density: RowDensity) => void;
  }

  let {
    accent,
    background,
    glass,
    avatars,
    density,
    language,
    onAccentChange,
    onLanguageChange = undefined,
    onBackgroundChange,
    onGlassChange,
    onAvatarsChange = undefined,
    onDensityChange = undefined,
  }: Props = $props();
  const { t } = useGitViewI18n();

  /** The three buttons, each drawn with its own node size so the choice is visible. */
  const DENSITIES = ROW_DENSITIES.map((id) => {
    const metrics = densityMetrics(id);
    return {
      id,
      name:
        id === "compact"
          ? m.settings_density_compact()
          : id === "comfortable"
            ? m.settings_density_comfortable()
            : m.settings_density_roomy(),
      // The dot in the button is the graph's node at that density, capped so the
      // roomy one does not outgrow the button.
      node: Math.round(Math.min(14, metrics.radius * 2)),
      dots: 3,
    };
  });

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
      name: t("appearance.accent.neutral"),
      color: "#52525b",
      bg: "bg-zinc-600",
    },
    {
      id: "blue",
      name: t("appearance.accent.blue"),
      color: "#2563eb",
      bg: "bg-blue-600",
    },
    {
      id: "emerald",
      name: t("appearance.accent.emerald"),
      color: "#059669",
      bg: "bg-emerald-600",
    },
    {
      id: "violet",
      name: t("appearance.accent.violet"),
      color: "#7c3aed",
      bg: "bg-violet-600",
    },
    {
      id: "rose",
      name: t("appearance.accent.rose"),
      color: "#e11d48",
      bg: "bg-rose-600",
    },
    {
      id: "amber",
      name: t("appearance.accent.amber"),
      color: "#d97706",
      bg: "bg-amber-600",
    },
    {
      id: "cyan",
      name: t("appearance.accent.cyan"),
      color: "#0891b2",
      bg: "bg-cyan-600",
    },
  ];

  const PRESET_BACKGROUNDS = [
    {
      id: "none",
      title: t("appearance.background.solid"),
      desc: t("appearance.background.solidDescription"),
      thumbnail: "bg-card border border-border",
    },
    {
      id: "/backgrounds/mountain-mist.svg",
      title: t("appearance.background.mountain"),
      desc: t("appearance.background.mountainDescription"),
      thumbnail: "bg-gradient-to-br from-slate-400 via-blue-300 to-sky-100",
    },
    {
      id: "/backgrounds/aurora.svg",
      title: t("appearance.background.aurora"),
      desc: t("appearance.background.auroraDescription"),
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
      {t("appearance.accent.title")}
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
        {t("appearance.background.title")}
      </span>
      {#if background !== "none"}
        <Badge tone="branch" class="text-[10px]">{t("appearance.active")}</Badge
        >
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
        placeholder={t("appearance.customUrlPlaceholder")}
        aria-label={t("appearance.customUrl")}
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
        {t("appearance.applyUrl")}
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
          {t("appearance.clear")}
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
        >{t("appearance.glass.title")}</span
      >
      <span class="text-[11px] text-ink-faint">
        {t("appearance.glass.description")}
      </span>
    </div>
    <label class="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={glass}
        onchange={(e) => onGlassChange(e.currentTarget.checked)}
        class="sr-only peer"
        aria-label={t("appearance.glass.toggle")}
      />
      <div
        class="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"
      ></div>
    </label>
  </div>

  <!-- Author Photos Toggle -->
  <div
    class="flex items-center justify-between rounded-lg border border-border/60 bg-card/50 p-3"
  >
    <div class="flex flex-col gap-0.5">
      <span class="text-xs font-medium text-foreground"
        >{t("appearance.avatars.title")}</span
      >
      <span class="text-[11px] text-ink-faint">
        {t("appearance.avatars.description")}
      </span>
    </div>
    <label class="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={avatars}
        onchange={(e) => onAvatarsChange?.(e.currentTarget.checked)}
        class="sr-only peer"
        aria-label={t("appearance.avatars.toggle")}
        data-testid="settings-avatars-toggle"
      />
      <div
        class="w-9 h-5 bg-muted peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-border after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"
      ></div>
    </label>
  </div>

  <!-- Language -->
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between">
      <span
        class="text-xs font-semibold uppercase tracking-wider text-ink-muted"
      >
        {m.settings_language()}
      </span>
      <span class="text-[11px] text-ink-faint"
        >{language === "auto" ? m.settings_language_auto_hint() : ""}</span
      >
    </div>
    <div
      class="grid grid-cols-3 gap-2"
      role="radiogroup"
      aria-label={m.settings_language()}
    >
      {#each languageChoices() as choice (choice.id)}
        {@const active = language === choice.id}
        <button
          type="button"
          role="radio"
          aria-checked={active}
          onclick={() => onLanguageChange?.(choice.id)}
          class={cn(
            "flex items-center justify-center gap-2 rounded-lg border p-2 text-left text-xs transition-all",
            active
              ? "border-primary bg-primary/10 font-medium text-foreground shadow-xs"
              : "border-border/60 bg-card/60 hover:border-border hover:bg-accent/40 text-ink-muted",
          )}
          data-testid={`settings-language-${choice.id}`}
        >
          <span class="truncate">{choice.label}</span>
        </button>
      {/each}
    </div>
  </div>

  <!-- Row Density -->
  <div class="flex flex-col gap-2">
    <div class="flex items-center justify-between">
      <span
        class="text-xs font-semibold uppercase tracking-wider text-ink-muted"
      >
        {m.settings_density()}
      </span>
      <span class="text-[11px] text-ink-faint"
        >{density === "compact"
          ? m.settings_density_compact()
          : density === "comfortable"
            ? m.settings_density_comfortable()
            : m.settings_density_roomy()}</span
      >
    </div>
    <div
      class="grid grid-cols-3 gap-2"
      role="radiogroup"
      aria-label={m.settings_density()}
    >
      {#each DENSITIES as item (item.id)}
        {@const active = density === item.id}
        <button
          type="button"
          role="radio"
          aria-checked={active}
          onclick={() => onDensityChange?.(item.id)}
          class={cn(
            "flex items-center gap-2 rounded-lg border p-2 text-left text-xs transition-all",
            active
              ? "border-primary bg-primary/10 font-medium text-foreground shadow-xs"
              : "border-border/60 bg-card/60 hover:border-border hover:bg-accent/40 text-ink-muted",
          )}
          data-testid={`settings-density-${item.id}`}
        >
          <span class="flex shrink-0 items-center gap-1">
            {#each Array(item.dots) as _, dot (dot)}
              <span
                class="rounded-full bg-ink-faint/70"
                style="width: {item.node}px; height: {item.node}px"
              ></span>
            {/each}
          </span>
          <span class="truncate">{item.name}</span>
        </button>
      {/each}
    </div>
  </div>
</div>
