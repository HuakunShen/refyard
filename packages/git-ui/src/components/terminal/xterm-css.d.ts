/**
 * Ambient declarations for CSS the lazy xterm loader imports.
 *
 * The stylesheet ships inside the xterm chunk, so a workbench that never opens
 * a terminal never downloads it — and TypeScript only needs to know the module
 * exists, not what a stylesheet exports.
 */
declare module "@xterm/xterm/css/xterm.css";
