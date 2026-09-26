/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sidebar_BranchesInputs */

const en_sidebar_branches = /** @type {(inputs: Sidebar_BranchesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Branches`)
};

const zh_sidebar_branches = /** @type {(inputs: Sidebar_BranchesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`分支`)
};

/**
* | output |
* | --- |
* | "Branches" |
*
* @param {Sidebar_BranchesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sidebar_branches = /** @type {((inputs?: Sidebar_BranchesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sidebar_BranchesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_sidebar_branches(inputs)
	return en_sidebar_branches(inputs)
});