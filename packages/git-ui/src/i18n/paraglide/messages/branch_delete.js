/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Branch_DeleteInputs */

const en_branch_delete = /** @type {(inputs: Branch_DeleteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Delete branch`)
};

const zh_branch_delete = /** @type {(inputs: Branch_DeleteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`删除分支`)
};

/**
* | output |
* | --- |
* | "Delete branch" |
*
* @param {Branch_DeleteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_delete = /** @type {((inputs?: Branch_DeleteInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Branch_DeleteInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_branch_delete(inputs)
	return en_branch_delete(inputs)
});