<!--
  Refyard brand mark and wordmark component.
  Supports mark-only (square icon) and full logo (mark + stylized wordmark).
-->
<script lang="ts">
  import { cn } from "../lib/utils.js";

  interface Props {
    variant?: "mark" | "full" | "icon";
    size?: number;
    class?: string;
  }

  let { variant = "full", size = 28, class: className = "" }: Props = $props();
</script>

{#if variant === "mark"}
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 256 256"
    width={size}
    height={size}
    role="img"
    aria-label="Refyard"
    class={cn("shrink-0", className)}
  >
    <defs>
      <linearGradient id="ryNavyGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#1e3a5f" />
        <stop offset="1" stop-color="#0a1b2d" />
      </linearGradient>
      <linearGradient id="ryBlueGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#3b82f6" />
        <stop offset="1" stop-color="#1d4ed8" />
      </linearGradient>
    </defs>

    <!-- back page -->
    <path
      d="M32 72 Q32 56 47 50 L108 27 Q118 23 118 35 L118 57 L72 74 Q61 78 61 90 L61 191 Q61 202 51 207 L43 211 Q32 206 32 194 Z"
      fill="url(#ryNavyGrad)"
      stroke="currentColor"
      stroke-opacity="0.15"
      stroke-width="8"
      stroke-linejoin="round"
    />

    <!-- middle page -->
    <path
      d="M57 82 Q57 67 70 62 L131 39 Q141 35 141 47 L141 70 L96 87 Q85 91 85 103 L85 198 Q85 209 75 214 L67 218 Q57 213 57 202 Z"
      fill="#112a45"
      stroke="currentColor"
      stroke-opacity="0.25"
      stroke-width="8"
      stroke-linejoin="round"
    />

    <!-- front page -->
    <path
      d="M84 96 Q84 81 97 76 L151 56 Q162 52 162 64 L162 110 Q162 123 150 128 L115 142 Q104 147 104 159 L104 198 Q104 211 91 217 L84 220 Q76 216 76 205 L76 109 Q76 101 84 96 Z"
      fill="url(#ryNavyGrad)"
      stroke="currentColor"
      stroke-opacity="0.3"
      stroke-width="8"
      stroke-linejoin="round"
    />

    <!-- blue ref path -->
    <path
      d="M173 60 C173 91 171 104 153 114 C132 126 119 132 119 153"
      fill="none"
      stroke="url(#ryBlueGrad)"
      stroke-width="13"
      stroke-linecap="round"
      stroke-linejoin="round"
    />

    <!-- branch to secondary ref -->
    <path
      d="M119 153 C128 171 146 184 174 198"
      fill="none"
      stroke="#38bdf8"
      stroke-width="11"
      stroke-linecap="round"
      stroke-linejoin="round"
    />

    <!-- ref nodes -->
    <circle
      cx="173"
      cy="56"
      r="22"
      fill="#ffffff"
      stroke="url(#ryBlueGrad)"
      stroke-width="12"
    />
    <circle
      cx="119"
      cy="153"
      r="19"
      fill="#ffffff"
      stroke="url(#ryBlueGrad)"
      stroke-width="11"
    />
    <circle
      cx="184"
      cy="202"
      r="17"
      fill="#ffffff"
      stroke="#38bdf8"
      stroke-width="10"
    />
  </svg>
{:else if variant === "icon"}
  <div
    class={cn(
      "flex items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/20 via-primary/10 to-indigo-500/20 p-1 border border-border/60 shadow-xs",
      className,
    )}
    style:width="{size}px"
    style:height="{size}px"
  >
    <img
      src="/refyard-mark.svg"
      alt="Refyard"
      class="w-full h-full object-contain"
    />
  </div>
{:else}
  <div class={cn("flex items-center gap-2.5 select-none", className)}>
    <img
      src="/refyard-mark.svg"
      alt="Refyard"
      style:width="{size}px"
      style:height="{size}px"
      class="shrink-0 drop-shadow-xs"
    />
    <div class="flex flex-col leading-none">
      <span class="text-sm font-bold tracking-tight text-foreground font-sans">
        Ref<span class="text-primary">y</span>ard
      </span>
      <span
        class="text-[9px] font-medium tracking-wider text-muted-foreground uppercase"
      >
        Workbench
      </span>
    </div>
  </div>
{/if}
