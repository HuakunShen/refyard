/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ branch: NonNullable<unknown>, upstream: NonNullable<unknown> }} Menu_Rebase_Branch_OntoInputs */

const en_menu_rebase_branch_onto = /** @type {(inputs: Menu_Rebase_Branch_OntoInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Rebase ${i?.branch} onto ${i?.upstream}`)
};

const zh_menu_rebase_branch_onto = /** @type {(inputs: Menu_Rebase_Branch_OntoInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`将 ${i?.branch} 变基到 ${i?.upstream}`)
};

/**
* | output |
* | --- |
* | "Rebase {branch} onto {upstream}" |
*
* @param {Menu_Rebase_Branch_OntoInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_rebase_branch_onto = /** @type {((inputs: Menu_Rebase_Branch_OntoInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Menu_Rebase_Branch_OntoInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_menu_rebase_branch_onto(inputs)
	return en_menu_rebase_branch_onto(inputs)
});