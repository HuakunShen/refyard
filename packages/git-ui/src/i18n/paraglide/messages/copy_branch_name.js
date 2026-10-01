/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Copy_Branch_NameInputs */

const en_copy_branch_name = /** @type {(inputs: Copy_Branch_NameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Copy Branch Name`)
};

const zh_copy_branch_name = /** @type {(inputs: Copy_Branch_NameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`复制分支名`)
};

/**
* | output |
* | --- |
* | "Copy Branch Name" |
*
* @param {Copy_Branch_NameInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_branch_name = /** @type {((inputs?: Copy_Branch_NameInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Copy_Branch_NameInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_copy_branch_name(inputs)
	return en_copy_branch_name(inputs)
});