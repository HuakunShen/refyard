/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Pr_Enter_Code_AtInputs */

const en_pr_enter_code_at = /** @type {(inputs: Pr_Enter_Code_AtInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Enter this code at`)
};

const zh_pr_enter_code_at = /** @type {(inputs: Pr_Enter_Code_AtInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`在以下位置输入此代码`)
};

/**
* | output |
* | --- |
* | "Enter this code at" |
*
* @param {Pr_Enter_Code_AtInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pr_enter_code_at = /** @type {((inputs?: Pr_Enter_Code_AtInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Pr_Enter_Code_AtInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_pr_enter_code_at(inputs)
	return en_pr_enter_code_at(inputs)
});