/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sub_Placeholder_BranchInputs */

const en_sub_placeholder_branch = /** @type {(inputs: Sub_Placeholder_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`branch (tracked)`)
};

const zh_sub_placeholder_branch = /** @type {(inputs: Sub_Placeholder_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`分支(已跟踪)`)
};

/**
* | output |
* | --- |
* | "branch (tracked)" |
*
* @param {Sub_Placeholder_BranchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sub_placeholder_branch = /** @type {((inputs?: Sub_Placeholder_BranchInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sub_Placeholder_BranchInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_sub_placeholder_branch(inputs)
	return en_sub_placeholder_branch(inputs)
});