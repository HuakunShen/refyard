/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Diff_SplitInputs */

const en_diff_split = /** @type {(inputs: Diff_SplitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Split`)
};

const zh_diff_split = /** @type {(inputs: Diff_SplitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`分栏`)
};

/**
* | output |
* | --- |
* | "Split" |
*
* @param {Diff_SplitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const diff_split = /** @type {((inputs?: Diff_SplitInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Diff_SplitInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_diff_split(inputs)
	return en_diff_split(inputs)
});