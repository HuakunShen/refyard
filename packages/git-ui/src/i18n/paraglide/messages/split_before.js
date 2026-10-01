/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Split_BeforeInputs */

const en_split_before = /** @type {(inputs: Split_BeforeInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Before`)
};

const zh_split_before = /** @type {(inputs: Split_BeforeInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`之前`)
};

/**
* | output |
* | --- |
* | "Before" |
*
* @param {Split_BeforeInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const split_before = /** @type {((inputs?: Split_BeforeInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Split_BeforeInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_split_before(inputs)
	return en_split_before(inputs)
});