/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_BackgroundInputs */

const en_settings_background = /** @type {(inputs: Settings_BackgroundInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Background`)
};

const zh_settings_background = /** @type {(inputs: Settings_BackgroundInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`背景`)
};

/**
* | output |
* | --- |
* | "Background" |
*
* @param {Settings_BackgroundInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_background = /** @type {((inputs?: Settings_BackgroundInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_BackgroundInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_background(inputs)
	return en_settings_background(inputs)
});