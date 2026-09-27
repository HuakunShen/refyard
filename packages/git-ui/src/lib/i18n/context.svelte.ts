/** Optional per-view translator; standalone Git UI defaults to English. */
import { getContext, hasContext, setContext } from "svelte";
import { createGitViewI18n } from "./catalog.js";

const GIT_VIEW_I18N = Symbol("git-view-i18n");
export type GitViewI18n = ReturnType<typeof createGitViewI18n>;

export function provideGitViewI18n(locale: string): GitViewI18n {
  const i18n = createGitViewI18n(locale);
  setContext(GIT_VIEW_I18N, i18n);
  return i18n;
}

export function useGitViewI18n(): GitViewI18n {
  return hasContext(GIT_VIEW_I18N) ? getContext<GitViewI18n>(GIT_VIEW_I18N) : createGitViewI18n("en");
}
