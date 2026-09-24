/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Language_AutoInputs */

const en_settings_language_auto = /** @type {(inputs: Settings_Language_AutoInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Auto`)
};

const zh_settings_language_auto = /** @type {(inputs: Settings_Language_AutoInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`自动`)
};

/**
* | output |
* | --- |
* | "Auto" |
*
* @param {Settings_Language_AutoInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_language_auto = /** @type {((inputs?: Settings_Language_AutoInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Language_AutoInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_language_auto(inputs)
	return en_settings_language_auto(inputs)
});