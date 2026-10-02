/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Toolbar_No_BranchInputs */

const en_toolbar_no_branch = /** @type {(inputs: Toolbar_No_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`HEAD is not on a branch`)
};

const zh_toolbar_no_branch = /** @type {(inputs: Toolbar_No_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`HEAD 不在分支上`)
};

/**
* | output |
* | --- |
* | "HEAD is not on a branch" |
*
* @param {Toolbar_No_BranchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const toolbar_no_branch = /** @type {((inputs?: Toolbar_No_BranchInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Toolbar_No_BranchInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_toolbar_no_branch(inputs)
	return en_toolbar_no_branch(inputs)
});