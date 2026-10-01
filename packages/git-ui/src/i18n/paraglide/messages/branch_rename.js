/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Branch_RenameInputs */

const en_branch_rename = /** @type {(inputs: Branch_RenameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Rename…`)
};

const zh_branch_rename = /** @type {(inputs: Branch_RenameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`重命名…`)
};

/**
* | output |
* | --- |
* | "Rename…" |
*
* @param {Branch_RenameInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_rename = /** @type {((inputs?: Branch_RenameInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Branch_RenameInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_branch_rename(inputs)
	return en_branch_rename(inputs)
});