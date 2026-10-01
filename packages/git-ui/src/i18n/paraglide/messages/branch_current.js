/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Branch_CurrentInputs */

const en_branch_current = /** @type {(inputs: Branch_CurrentInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Current branch`)
};

const zh_branch_current = /** @type {(inputs: Branch_CurrentInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`当前分支`)
};

/**
* | output |
* | --- |
* | "Current branch" |
*
* @param {Branch_CurrentInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_current = /** @type {((inputs?: Branch_CurrentInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Branch_CurrentInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_branch_current(inputs)
	return en_branch_current(inputs)
});