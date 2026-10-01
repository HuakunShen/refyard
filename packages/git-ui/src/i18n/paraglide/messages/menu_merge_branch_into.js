/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ source: NonNullable<unknown>, target: NonNullable<unknown> }} Menu_Merge_Branch_IntoInputs */

const en_menu_merge_branch_into = /** @type {(inputs: Menu_Merge_Branch_IntoInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Merge ${i?.source} into ${i?.target}`)
};

const zh_menu_merge_branch_into = /** @type {(inputs: Menu_Merge_Branch_IntoInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`将 ${i?.source} 合并到 ${i?.target}`)
};

/**
* | output |
* | --- |
* | "Merge {source} into {target}" |
*
* @param {Menu_Merge_Branch_IntoInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_merge_branch_into = /** @type {((inputs: Menu_Merge_Branch_IntoInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Menu_Merge_Branch_IntoInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_menu_merge_branch_into(inputs)
	return en_menu_merge_branch_into(inputs)
});