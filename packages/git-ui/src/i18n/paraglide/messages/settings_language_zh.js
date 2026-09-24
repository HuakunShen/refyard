/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Language_ZhInputs */

const en_settings_language_zh = /** @type {(inputs: Settings_Language_ZhInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`中文`)
};

const zh_settings_language_zh = /** @type {(inputs: Settings_Language_ZhInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`中文`)
};

/**
* | output |
* | --- |
* | "中文" |
*
* @param {Settings_Language_ZhInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_language_zh = /** @type {((inputs?: Settings_Language_ZhInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Language_ZhInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_language_zh(inputs)
	return en_settings_language_zh(inputs)
});