/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Language_Auto_HintInputs */

const en_settings_language_auto_hint = /** @type {(inputs: Settings_Language_Auto_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Follow the browser`)
};

const zh_settings_language_auto_hint = /** @type {(inputs: Settings_Language_Auto_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`跟随浏览器`)
};

/**
* | output |
* | --- |
* | "Follow the browser" |
*
* @param {Settings_Language_Auto_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_language_auto_hint = /** @type {((inputs?: Settings_Language_Auto_HintInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Language_Auto_HintInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_language_auto_hint(inputs)
	return en_settings_language_auto_hint(inputs)
});