/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Bg_MistInputs */

const en_bg_mist = /** @type {(inputs: Bg_MistInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Mountain Mist`)
};

const zh_bg_mist = /** @type {(inputs: Bg_MistInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`山间雾霭`)
};

/**
* | output |
* | --- |
* | "Mountain Mist" |
*
* @param {Bg_MistInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const bg_mist = /** @type {((inputs?: Bg_MistInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Bg_MistInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_bg_mist(inputs)
	return en_bg_mist(inputs)
});