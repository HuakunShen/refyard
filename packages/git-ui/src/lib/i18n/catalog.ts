/** Five checked catalogs and locale-sensitive display formatting. */
import en from "./locales/en.js";
import zhHans from "./locales/zh-Hans.js";
import ja from "./locales/ja.js";
import es from "./locales/es.js";
import fr from "./locales/fr.js";
import type { GitViewLocale, TranslationCatalog, TranslationKey } from "./types.js";
import { localizedAbsoluteTime, localizedRelativeTime, localizedAbsoluteMillis, localizedRelativeMillis, localizedBytes, shortOid } from "../format.js";

export const catalogs: Readonly<Record<GitViewLocale, TranslationCatalog>> = {
  en, "zh-Hans": zhHans, ja, es, fr,
};

const statusLetterKeys: Readonly<Record<string, TranslationKey>> = {
  ".": "status.letter.unchanged", M: "status.letter.modified", T: "status.letter.typeChanged",
  A: "status.letter.added", D: "status.letter.deleted", R: "status.letter.renamed",
  C: "status.letter.copied", U: "status.letter.unmerged", "?": "status.letter.untracked",
  "!": "status.letter.ignored",
};
const statusKindKeys: Readonly<Record<string, TranslationKey>> = {
  ordinary: "status.kind.ordinary", renamed: "status.kind.renamed", copied: "status.kind.copied",
  unmerged: "status.kind.unmerged", untracked: "status.kind.untracked", ignored: "status.kind.ignored",
};

export function selectGitViewLocale(value: string | null | undefined): GitViewLocale {
  if (value === undefined || value === null) return "en";
  const normalized = value.toLowerCase();
  if (normalized === "zh-hans" || normalized.startsWith("zh-hans-") ||
    normalized === "zh-cn" || normalized.startsWith("zh-cn-") ||
    normalized === "zh-sg" || normalized.startsWith("zh-sg-")) return "zh-Hans";
  if (normalized === "ja" || normalized.startsWith("ja-")) return "ja";
  if (normalized === "es" || normalized.startsWith("es-")) return "es";
  if (normalized === "fr" || normalized.startsWith("fr-")) return "fr";
  return "en";
}

export function createGitViewI18n(value: string | null | undefined) {
  const locale = selectGitViewLocale(value);
  const catalog = catalogs[locale];
  const t = (key: TranslationKey): string => catalog[key];
  const count = (number: number | bigint): string => new Intl.NumberFormat(locale).format(number);
  const plural = (number: number, one: TranslationKey, other: TranslationKey): string => {
    const category = new Intl.PluralRules(locale).select(number);
    return `${count(number)} ${t(category === "one" ? one : other)}`;
  };
  const paths = (number: number): string => plural(number, "xross.count.pathOne", "xross.count.pathOther");
  const worktrees = (number: number): string => plural(number, "repository.worktree.one", "repository.worktree.other");
  const statusLetter = (letter: string): string => {
    const key = statusLetterKeys[letter];
    return key === undefined ? letter : t(key);
  };
  const statusKind = (kind: string): string => {
    const key = statusKindKeys[kind];
    return key === undefined ? kind : t(key);
  };
  const head = (value: { readonly kind: "born" | "unborn"; readonly branchName: string | null;
    readonly oid: string | null; readonly detached: boolean }): string => {
    if (value.kind === "unborn") return t("git.head.unborn");
    if (value.detached && value.oid !== null) return `${t("git.head.detachedAt")} ${shortOid(value.oid)}`;
    if (value.branchName !== null) return value.branchName;
    return value.oid === null ? t("git.head.unknown") : shortOid(value.oid);
  };
  const absoluteTime = (unixMillis: string): string => localizedAbsoluteTime(unixMillis, locale) ?? t("xross.time.invalid");
  const relativeTime = (unixMillis: string, now: number): string => localizedRelativeTime(unixMillis, now, locale) ?? t("xross.time.invalid");
  const absoluteIso = (isoTimestamp: string): string => localizedAbsoluteMillis(Date.parse(isoTimestamp), locale) ?? t("xross.time.invalid");
  const relativeIso = (isoTimestamp: string, now: number): string => localizedRelativeMillis(Date.parse(isoTimestamp), now, locale) ?? t("xross.time.invalid");
  const bytes = (decimal: string): string => localizedBytes(decimal, locale) ?? t("xross.value.unavailable");
  return { locale, t, count, plural, paths, worktrees, statusLetter, statusKind, head,
    absoluteTime, relativeTime, absoluteIso, relativeIso, bytes };
}
