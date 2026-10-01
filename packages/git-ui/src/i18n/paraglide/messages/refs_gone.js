/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Refs_GoneInputs */

const en_refs_gone = /** @type {(inputs: Refs_GoneInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`gone`)
};

const zh_refs_gone = /** @type {(inputs: Refs_GoneInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`已消失`)
};

/**
* | output |
* | --- |
* | "gone" |
*
* @param {Refs_GoneInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const refs_gone = /** @type {((inputs?: Refs_GoneInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Refs_GoneInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_refs_gone(inputs)
	return en_refs_gone(inputs)
});