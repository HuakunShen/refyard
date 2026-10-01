/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Mode_DarkInputs */

const en_mode_dark = /** @type {(inputs: Mode_DarkInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Dark`)
};

const zh_mode_dark = /** @type {(inputs: Mode_DarkInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`深色`)
};

/**
* | output |
* | --- |
* | "Dark" |
*
* @param {Mode_DarkInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const mode_dark = /** @type {((inputs?: Mode_DarkInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Mode_DarkInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_mode_dark(inputs)
	return en_mode_dark(inputs)
});