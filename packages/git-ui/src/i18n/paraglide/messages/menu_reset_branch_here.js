/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Menu_Reset_Branch_HereInputs */

const en_menu_reset_branch_here = /** @type {(inputs: Menu_Reset_Branch_HereInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Reset Branch to Here…`)
};

const zh_menu_reset_branch_here = /** @type {(inputs: Menu_Reset_Branch_HereInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`把分支重置到这里…`)
};

/**
* | output |
* | --- |
* | "Reset Branch to Here…" |
*
* @param {Menu_Reset_Branch_HereInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_reset_branch_here = /** @type {((inputs?: Menu_Reset_Branch_HereInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Menu_Reset_Branch_HereInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_menu_reset_branch_here(inputs)
	return en_menu_reset_branch_here(inputs)
});