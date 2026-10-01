/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Branch_Merge_CreatesInputs */

const en_branch_merge_creates = /** @type {(inputs: Branch_Merge_CreatesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`merge creates a commit`)
};

const zh_branch_merge_creates = /** @type {(inputs: Branch_Merge_CreatesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`合并产生一个提交`)
};

/**
* | output |
* | --- |
* | "merge creates a commit" |
*
* @param {Branch_Merge_CreatesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_merge_creates = /** @type {((inputs?: Branch_Merge_CreatesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Branch_Merge_CreatesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_branch_merge_creates(inputs)
	return en_branch_merge_creates(inputs)
});