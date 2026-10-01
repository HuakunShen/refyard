/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Ref_Branch_NameInputs */

const en_ref_branch_name = /** @type {(inputs: Ref_Branch_NameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Branch name`)
};

const zh_ref_branch_name = /** @type {(inputs: Ref_Branch_NameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`分支名`)
};

/**
* | output |
* | --- |
* | "Branch name" |
*
* @param {Ref_Branch_NameInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const ref_branch_name = /** @type {((inputs?: Ref_Branch_NameInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Ref_Branch_NameInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_ref_branch_name(inputs)
	return en_ref_branch_name(inputs)
});