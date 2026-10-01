/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Split_AfterInputs */

const en_split_after = /** @type {(inputs: Split_AfterInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`After`)
};

const zh_split_after = /** @type {(inputs: Split_AfterInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`之后`)
};

/**
* | output |
* | --- |
* | "After" |
*
* @param {Split_AfterInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const split_after = /** @type {((inputs?: Split_AfterInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Split_AfterInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_split_after(inputs)
	return en_split_after(inputs)
});