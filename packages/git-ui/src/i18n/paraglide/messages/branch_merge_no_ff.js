/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Branch_Merge_No_FfInputs */

const en_branch_merge_no_ff = /** @type {(inputs: Branch_Merge_No_FfInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`merge always creates a commit (--no-ff)`)
};

const zh_branch_merge_no_ff = /** @type {(inputs: Branch_Merge_No_FfInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`合并总是产生一个提交(--no-ff)`)
};

/**
* | output |
* | --- |
* | "merge always creates a commit (--no-ff)" |
*
* @param {Branch_Merge_No_FfInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_merge_no_ff = /** @type {((inputs?: Branch_Merge_No_FfInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Branch_Merge_No_FfInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_branch_merge_no_ff(inputs)
	return en_branch_merge_no_ff(inputs)
});