/** Locale and checked translation-key types shared across Git UI components. */
import type english from "./locales/en.js";

export type GitViewLocale = "en" | "zh-Hans" | "ja" | "es" | "fr";
export type TranslationKey = keyof typeof english;
export type TranslationCatalog = Readonly<Record<TranslationKey, string>>;
export type Translator = (key: TranslationKey) => string;
