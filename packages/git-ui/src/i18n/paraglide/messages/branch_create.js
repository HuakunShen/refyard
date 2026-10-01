/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Branch_CreateInputs */

const en_branch_create = /** @type {(inputs: Branch_CreateInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Create`)
};

const zh_branch_create = /** @type {(inputs: Branch_CreateInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`创建`)
};

/**
* | output |
* | --- |
* | "Create" |
*
* @param {Branch_CreateInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_create = /** @type {((inputs?: Branch_CreateInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Branch_CreateInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_branch_create(inputs)
	return en_branch_create(inputs)
});