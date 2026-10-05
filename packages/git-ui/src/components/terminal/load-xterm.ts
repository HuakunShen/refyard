/**
 * The lazy xterm loader.
 *
 * xterm.js is the heaviest thing the workbench can put on screen, so it is
 * imported only when a terminal tab is actually opened — a dynamic import the
 * bundler turns into its own chunk that never touches the workbench's first
 * paint. The promise is cached: one bundle, shared by every tab.
 */
type TerminalConstructor = typeof import("@xterm/xterm").Terminal;
type FitAddonConstructor = typeof import("@xterm/addon-fit").FitAddon;

export interface XtermBundle {
  readonly Terminal: TerminalConstructor;
  readonly FitAddon: FitAddonConstructor;
}

let bundle: Promise<XtermBundle> | null = null;

export function loadXterm(): Promise<XtermBundle> {
  bundle ??= (async () => {
    const [{ Terminal }, { FitAddon }] = await Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
    ]);
    // The stylesheet rides the same lazy chunk, so a workbench that never opens
    // a terminal never downloads it.
    await import("@xterm/xterm/css/xterm.css");
    return { Terminal, FitAddon };
  })();
  return bundle;
}
