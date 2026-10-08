<!--
	One terminal tab: the xterm instance, its session, and the wiring between
	them. Inactive tabs stay mounted and *invisible* — never `display:none`,
	which collapses the container to zero and would truncate both the local
	buffer and the host's pty on a refit (the wterm lesson from kkterminal).
	The session half lives in ../lib/terminal-tab-session.ts and must never
	outlive this component: unmounting runs the same teardown as closing the
	tab, so a dock that goes away takes its shells, their buffers, and their
	host-side ptys with it instead of leaking them behind the workbench.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import type { Terminal as XTerm } from "@xterm/xterm";
  import type { FitAddon } from "@xterm/addon-fit";
  import type { TerminalOpenResponse } from "@refyard/git-contract";
  import type { TerminalService } from "@refyard/git-service";
  import {
    TERMINAL_SCROLLBACK_LINES,
    startTerminalTab,
    type TerminalTabSession,
  } from "../lib/terminal-tab-session.js";
  import { loadXterm } from "./terminal/load-xterm.js";

  let {
    terminal,
    repositoryId,
    active,
    onReady,
    onExit,
    fontFamily,
  }: {
    terminal: TerminalService;
    repositoryId: string;
    active: boolean;
    onReady: (info: TerminalOpenResponse) => void;
    onExit: (exitCode: number | null) => void;
    /** Terminal font stack. Nerd-Font-first so prompt glyphs (powerline, git icons) render. */
    fontFamily?: string | undefined;
  } = $props();

  let container: HTMLDivElement | null = $state(null);
  let term: XTerm | null = null;
  let fit: FitAddon | null = null;
  let tab: TerminalTabSession | null = null;
  let disposed = false;
  let resizeTimer: ReturnType<typeof setTimeout> | null = null;
  let observer: ResizeObserver | null = null;

  function fitNow(): void {
    if (fit === null || term === null || container === null) {
      return;
    }
    // A collapsed container would propose a 1×1 grid, which truncates the
    // buffer *and* the host's pty; refusing is the wterm resize landmine.
    if (container.clientWidth < 20 || container.clientHeight < 20) {
      return;
    }
    fit.fit();
  }

  function scheduleResize(): void {
    if (resizeTimer !== null) {
      clearTimeout(resizeTimer);
    }
    // A trailing debounce: dragging the dock's edge fires many resizes, and
    // only the last one describes a grid anyone wants the pty to adopt. The
    // grid dedupe in the session breaks the observer loop: a fit that
    // changes nothing must not fire another observer round.
    resizeTimer = setTimeout(() => {
      resizeTimer = null;
      fitNow();
      if (term !== null) {
        tab?.resize(term.cols, term.rows);
      }
    }, 150);
  }

  async function teardown(): Promise<void> {
    disposed = true;
    observer?.disconnect();
    observer = null;
    if (resizeTimer !== null) {
      clearTimeout(resizeTimer);
      resizeTimer = null;
    }
    const ending = tab?.destroy();
    tab = null;
    await ending;
  }

  export async function destroy(): Promise<void> {
    await teardown();
  }

  export function refit(): void {
    fitNow();
    if (term !== null) {
      tab?.resize(term.cols, term.rows);
    }
  }

  onMount(() => {
    void (async () => {
      if (container === null || disposed) {
        return;
      }
      const { Terminal, FitAddon: FitAddonConstructor } = await loadXterm();
      if (disposed || container === null) {
        return;
      }
      const instance = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily:
          fontFamily ??
          // Nerd-Font glyphs first (powerline separators, git icons), then the
          // platform monospace fallbacks. MesloLGS NF is the common Nerd Font;
          // a machine without it falls through cleanly.
          '"MesloLGS NF", "MesloLGSDZ Nerd Font", "JetBrainsMono Nerd Font", Menlo, Monaco, "Courier New", monospace',
        scrollback: TERMINAL_SCROLLBACK_LINES,
        // The panel paints the canvas color; the emulator stays transparent
        // over it so the interface style (web/macos/windows/linux) shows.
        allowTransparency: true,
        theme: {
          background: "rgba(0, 0, 0, 0)",
          foreground: "#d4d4d4",
          cursor: "#d4d4d4",
          cursorAccent: "#0a0a0a",
          selectionBackground: "#5a5a8a66",
        },
      });
      const fitAddon = new FitAddonConstructor();
      instance.loadAddon(fitAddon);
      instance.open(container);
      term = instance;
      fit = fitAddon;
      fitNow();

      observer = new ResizeObserver(scheduleResize);
      observer.observe(container);

      const started = startTerminalTab(terminal, repositoryId, instance, {
        onReady: (info) => {
          onReady(info);
          instance.focus();
        },
        onExit,
      });
      tab = started;
      if (disposed) {
        // Unmount won the race with the lazy xterm load; the session that
        // just started must not outlive the component.
        void started.destroy();
        tab = null;
      }
    })();
    return () => {
      void teardown();
    };
  });

  $effect(() => {
    if (active) {
      // A tab that was hidden had a real size all along (visibility, not
      // display), but focus and any deferred refit belong to the visible one.
      refit();
      term?.focus();
    }
  });
</script>

<div
  class="absolute inset-0 overflow-hidden [&_.xterm]:h-full [&_.xterm]:p-2"
  style:visibility={active ? "visible" : "hidden"}
  bind:this={container}
></div>
