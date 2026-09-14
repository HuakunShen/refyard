/**
 * SvelteKit is a router here, not a server.
 *
 * `ssr = false` because the page is meaningless without a browser: it holds a session
 * token in memory and talks to a local service. `prerender = true` writes the shell that
 * `adapter-static` needs; the fallback (`200.html`) covers client-side routes.
 *
 * Nothing in this route tree may read `window` at module scope — the prerenderer imports
 * these modules in Node.
 */
export const ssr = false;
export const prerender = true;
