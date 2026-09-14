/**
 * The placeholder document this build serves when no web bundle is installed.
 *
 * It exists so that opening the printed URL in a browser shows something true: the
 * API is running, the UI is not in this build, and the pairing link is below. It
 * contains no repository data, loads nothing from anywhere, and is replaced by the
 * real Svelte app's `200.html` as soon as `apps/web` is built — the asset server
 * prefers the packaged directory and only falls back to this.
 */
export const MINIMAL_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>refyard</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; margin: 0; padding: 3rem 1.5rem; }
  main { max-width: 42rem; margin: 0 auto; }
  code, a { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  a { color: inherit; }
  .note { opacity: 0.75; }
  hr { border: none; border-top: 1px solid currentColor; opacity: 0.15; margin: 2rem 0; }
</style>
</head>
<body>
<main>
  <h1>refyard</h1>
  <p>This installation has no web build, so this placeholder page is being served.
  The authenticated API is running on this origin.</p>
  <p class="note">The browser workbench (SvelteKit static app) arrives with the web
  build; until then the API is reachable with a bearer token from the CLI's pairing
  URL, for example:</p>
  <p><code>GET /api/v1/capabilities</code> with <code>Authorization: Bearer &lt;token&gt;</code></p>
  <hr>
  <p class="note">If this page appeared after you clicked the CLI's pairing URL, the
  web build is missing rather than your session being broken.</p>
</main>
</body>
</html>
`;
