<script lang="ts">
  /**
   * Light / dark / system, as a dropdown.
   *
   * This follows shadcn-svelte's dark-mode recipe for Svelte: `mode-watcher` owns the
   * `dark` class on `<html>` (see `styles.css` for how the theme is wired to that class),
   * and this component is only the control — `setMode` for an explicit choice, `resetMode`
   * to hand the decision back to the operating system.
   *
   * The three options are spelled out rather than reduced to a sun/moon flip because
   * "follow the system" is a real answer, not a default to be silently overwritten: a user
   * who chose dark because their OS did should be able to give that back.
   */
  import { resetMode, setMode } from "mode-watcher";
  import SunIcon from "@lucide/svelte/icons/sun";
  import MoonIcon from "@lucide/svelte/icons/moon";
  import MonitorIcon from "@lucide/svelte/icons/monitor";
  import { buttonVariants } from "./ui/button/index.js";
  import * as DropdownMenu from "./ui/dropdown-menu/index.js";
  import { cn } from "../lib/utils.js";
  import { useGitViewI18n } from "../lib/i18n/context.svelte.js";

  let { class: className = "" }: { class?: string } = $props();
  const { t } = useGitViewI18n();
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class={cn(
      buttonVariants({ variant: "outline", size: "icon" }),
      "relative",
      className,
    )}
    aria-label={t("theme.toggle")}
    title={t("theme.toggle")}
  >
    <SunIcon
      class="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0"
    />
    <MoonIcon
      class="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100"
    />
  </DropdownMenu.Trigger>
  <DropdownMenu.Content align="end">
    <DropdownMenu.Item onclick={() => setMode("light")}>
      <SunIcon class="size-4" />
      {t("theme.light")}
    </DropdownMenu.Item>
    <DropdownMenu.Item onclick={() => setMode("dark")}>
      <MoonIcon class="size-4" />
      {t("theme.dark")}
    </DropdownMenu.Item>
    <DropdownMenu.Item onclick={resetMode}>
      <MonitorIcon class="size-4" />
      {t("theme.system")}
    </DropdownMenu.Item>
  </DropdownMenu.Content>
</DropdownMenu.Root>
