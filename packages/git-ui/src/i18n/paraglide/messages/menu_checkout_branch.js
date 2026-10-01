/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Menu_Checkout_BranchInputs */

const en_menu_checkout_branch = /** @type {(inputs: Menu_Checkout_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Checkout`)
};

const zh_menu_checkout_branch = /** @type {(inputs: Menu_Checkout_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`切换分支`)
};

/**
* | output |
* | --- |
* | "Checkout" |
*
* @param {Menu_Checkout_BranchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_checkout_branch = /** @type {((inputs?: Menu_Checkout_BranchInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Menu_Checkout_BranchInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_menu_checkout_branch(inputs)
	return en_menu_checkout_branch(inputs)
});