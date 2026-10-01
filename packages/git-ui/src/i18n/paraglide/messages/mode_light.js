/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Mode_LightInputs */

const en_mode_light = /** @type {(inputs: Mode_LightInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Light`)
};

const zh_mode_light = /** @type {(inputs: Mode_LightInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`浅色`)
};

/**
* | output |
* | --- |
* | "Light" |
*
* @param {Mode_LightInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const mode_light = /** @type {((inputs?: Mode_LightInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Mode_LightInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_mode_light(inputs)
	return en_mode_light(inputs)
});