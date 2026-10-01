/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Branch_New_Name_AriaInputs */

const en_branch_new_name_aria = /** @type {(inputs: Branch_New_Name_AriaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`new branch name`)
};

const zh_branch_new_name_aria = /** @type {(inputs: Branch_New_Name_AriaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`新分支名`)
};

/**
* | output |
* | --- |
* | "new branch name" |
*
* @param {Branch_New_Name_AriaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_new_name_aria = /** @type {((inputs?: Branch_New_Name_AriaInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Branch_New_Name_AriaInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_branch_new_name_aria(inputs)
	return en_branch_new_name_aria(inputs)
});