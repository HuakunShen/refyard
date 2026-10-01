/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Branch_Merge_CurrentInputs */

const en_branch_merge_current = /** @type {(inputs: Branch_Merge_CurrentInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Merge into Current`)
};

const zh_branch_merge_current = /** @type {(inputs: Branch_Merge_CurrentInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`合并到当前分支`)
};

/**
* | output |
* | --- |
* | "Merge into Current" |
*
* @param {Branch_Merge_CurrentInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_merge_current = /** @type {((inputs?: Branch_Merge_CurrentInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Branch_Merge_CurrentInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_branch_merge_current(inputs)
	return en_branch_merge_current(inputs)
});