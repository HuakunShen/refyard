/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Branch_Merge_InInputs */

const en_branch_merge_in = /** @type {(inputs: Branch_Merge_InInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Merge in`)
};

const zh_branch_merge_in = /** @type {(inputs: Branch_Merge_InInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`合并进来`)
};

/**
* | output |
* | --- |
* | "Merge in" |
*
* @param {Branch_Merge_InInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_merge_in = /** @type {((inputs?: Branch_Merge_InInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Branch_Merge_InInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_branch_merge_in(inputs)
	return en_branch_merge_in(inputs)
});