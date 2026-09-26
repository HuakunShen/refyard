/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_GlassInputs */

const en_settings_glass = /** @type {(inputs: Settings_GlassInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Glass`)
};

const zh_settings_glass = /** @type {(inputs: Settings_GlassInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`毛玻璃`)
};

/**
* | output |
* | --- |
* | "Glass" |
*
* @param {Settings_GlassInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_glass = /** @type {((inputs?: Settings_GlassInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_GlassInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_glass(inputs)
	return en_settings_glass(inputs)
});