/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sub_Aria_BranchInputs */

const en_sub_aria_branch = /** @type {(inputs: Sub_Aria_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`submodule branch`)
};

const zh_sub_aria_branch = /** @type {(inputs: Sub_Aria_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`子模块分支`)
};

/**
* | output |
* | --- |
* | "submodule branch" |
*
* @param {Sub_Aria_BranchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sub_aria_branch = /** @type {((inputs?: Sub_Aria_BranchInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sub_Aria_BranchInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_sub_aria_branch(inputs)
	return en_sub_aria_branch(inputs)
});