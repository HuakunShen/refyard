/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Refs_No_BranchesInputs */

const en_refs_no_branches = /** @type {(inputs: Refs_No_BranchesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No branches yet.`)
};

const zh_refs_no_branches = /** @type {(inputs: Refs_No_BranchesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`还没有分支。`)
};

/**
* | output |
* | --- |
* | "No branches yet." |
*
* @param {Refs_No_BranchesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const refs_no_branches = /** @type {((inputs?: Refs_No_BranchesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Refs_No_BranchesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_refs_no_branches(inputs)
	return en_refs_no_branches(inputs)
});