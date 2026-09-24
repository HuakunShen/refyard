/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_LanguageInputs */

const en_settings_language = /** @type {(inputs: Settings_LanguageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Language`)
};

const zh_settings_language = /** @type {(inputs: Settings_LanguageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`语言`)
};

/**
* | output |
* | --- |
* | "Language" |
*
* @param {Settings_LanguageInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_language = /** @type {((inputs?: Settings_LanguageInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_LanguageInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_language(inputs)
	return en_settings_language(inputs)
});