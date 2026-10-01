/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Menu_Current_BranchInputs */

const en_menu_current_branch = /** @type {(inputs: Menu_Current_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`current branch`)
};

const zh_menu_current_branch = /** @type {(inputs: Menu_Current_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`当前分支`)
};

/**
* | output |
* | --- |
* | "current branch" |
*
* @param {Menu_Current_BranchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_current_branch = /** @type {((inputs?: Menu_Current_BranchInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Menu_Current_BranchInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_menu_current_branch(inputs)
	return en_menu_current_branch(inputs)
});