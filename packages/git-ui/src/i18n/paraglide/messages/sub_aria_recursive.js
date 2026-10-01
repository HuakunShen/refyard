/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sub_Aria_RecursiveInputs */

const en_sub_aria_recursive = /** @type {(inputs: Sub_Aria_RecursiveInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`submodule recursive`)
};

const zh_sub_aria_recursive = /** @type {(inputs: Sub_Aria_RecursiveInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`子模块递归`)
};

/**
* | output |
* | --- |
* | "submodule recursive" |
*
* @param {Sub_Aria_RecursiveInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sub_aria_recursive = /** @type {((inputs?: Sub_Aria_RecursiveInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sub_Aria_RecursiveInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_sub_aria_recursive(inputs)
	return en_sub_aria_recursive(inputs)
});