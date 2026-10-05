<!--
	One terminal tab: the xterm instance, its session, and the wiring between
	them. Inactive tabs stay mounted and *invisible* — never `display:none`,
	which collapses the container to zero and would truncate both the local
	buffer and the host's pty on a refit (the wterm lesson from kkterminal).
	Input is batched for a few milliseconds, output goes straight to the
	emulator, and the pty follows the rendered grid after a short debounce.
-->
<script lang="ts">
	import { onMount } from "svelte";
	import type { Terminal as XTerm } from "@xterm/xterm";
	import type { FitAddon } from "@xterm/addon-fit";
	import type {
		TerminalOpenResponse,
	} from "@refyard/git-contract";
	import type {
		TerminalService,
		TerminalSessionHandle,
	} from "@refyard/git-service";
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
	let session: TerminalSessionHandle | null = $state(null);
	let disposed = false;
	/** The grid the pty was last told about; a resize is only sent on real change. */
	let sentCols = 0;
	let sentRows = 0;

	const encoder = new TextEncoder();
	/** Keystrokes accumulate here for a tick: one request per burst, not per key. */
	let inputQueue: Uint8Array[] = [];
	let inputTimer: ReturnType<typeof setTimeout> | null = null;
	let resizeTimer: ReturnType<typeof setTimeout> | null = null;
	let observer: ResizeObserver | null = null;

	function flushInput(): void {
		inputTimer = null;
		if (session === null || inputQueue.length === 0) {
			return;
		}
		const total = inputQueue.reduce((sum, chunk) => sum + chunk.byteLength, 0);
		const merged = new Uint8Array(total);
		let offset = 0;
		for (const chunk of inputQueue.splice(0)) {
			merged.set(chunk, offset);
			offset += chunk.byteLength;
		}
		session.write(merged);
	}

	function queueInput(data: string): void {
		inputQueue.push(encoder.encode(data));
		inputTimer ??= setTimeout(flushInput, 10);
	}

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
		// grid dedupe below also breaks the observer loop: a fit that changes
		// nothing must not fire another observer round.
		resizeTimer = setTimeout(() => {
			resizeTimer = null;
			fitNow();
			if (
				term !== null &&
				session !== null &&
				(term.cols !== sentCols || term.rows !== sentRows)
			) {
				sentCols = term.cols;
				sentRows = term.rows;
				session.resize(term.cols, term.rows);
			}
		}, 150);
	}

	export async function destroy(): Promise<void> {
		disposed = true;
		observer?.disconnect();
		observer = null;
		if (inputTimer !== null) {
			clearTimeout(inputTimer);
			inputTimer = null;
		}
		if (resizeTimer !== null) {
			clearTimeout(resizeTimer);
			resizeTimer = null;
		}
		const closing = session?.close();
		term?.dispose();
		term = null;
		await closing;
	}

	export function refit(): void {
		fitNow();
		if (
			term !== null &&
			session !== null &&
			(term.cols !== sentCols || term.rows !== sentRows)
		) {
			sentCols = term.cols;
			sentRows = term.rows;
			session.resize(term.cols, term.rows);
		}
	}

	onMount(() => {
		void (async () => {
			if (container === null || disposed) {
				return;
			}
			const { Terminal, FitAddon } = await loadXterm();
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
				scrollback: 5000,
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
			const fitAddon = new FitAddon();
			instance.loadAddon(fitAddon);
			instance.open(container);
			instance.onData(queueInput);
			term = instance;
			fit = fitAddon;
			fitNow();

			observer = new ResizeObserver(scheduleResize);
			observer.observe(container);

			const opened = await terminal.open(
				{
					repositoryId,
					cols: instance.cols,
					rows: instance.rows,
				},
				{
					onData: (chunk) => {
						instance.write(chunk);
					},
					onExit: (exitCode) => {
						onExit(exitCode);
						session = null;
					},
					onError: () => {
						// The transport died; the exit path renders the tab as dead and
						// the panel's error surface explains what happened.
						onExit(null);
						session = null;
					},
				},
			);
			if (disposed) {
				void opened.close();
				instance.dispose();
				return;
			}
			session = opened;
			sentCols = instance.cols;
			sentRows = instance.rows;
			// The host opened a grid it was asked for; the panel may have resized
			// while the session was starting, so the truth goes back once now.
			session.resize(instance.cols, instance.rows);
			onReady(opened.info);
			instance.focus();
		})();
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
