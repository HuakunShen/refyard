/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Branch_Rename_ShortInputs */

const en_branch_rename_short = /** @type {(inputs: Branch_Rename_ShortInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Rename`)
};

const zh_branch_rename_short = /** @type {(inputs: Branch_Rename_ShortInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`重命名`)
};

/**
* | output |
* | --- |
* | "Rename" |
*
* @param {Branch_Rename_ShortInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_rename_short = /** @type {((inputs?: Branch_Rename_ShortInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Branch_Rename_ShortInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_branch_rename_short(inputs)
	return en_branch_rename_short(inputs)
});