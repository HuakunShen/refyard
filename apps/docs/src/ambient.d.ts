/**
 * Vite loads the terminal stylesheet as an asset in the optional Git UI terminal
 * module. The public showcase does not load a terminal, but TS still traverses
 * the shared UI barrel when checking its Svelte components.
 */
declare module "@xterm/xterm/css/xterm.css";
