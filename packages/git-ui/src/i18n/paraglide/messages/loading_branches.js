/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Loading_BranchesInputs */

const en_loading_branches = /** @type {(inputs: Loading_BranchesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Reading branches…`)
};

const zh_loading_branches = /** @type {(inputs: Loading_BranchesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`正在读取分支…`)
};

/**
* | output |
* | --- |
* | "Reading branches…" |
*
* @param {Loading_BranchesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const loading_branches = /** @type {((inputs?: Loading_BranchesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Loading_BranchesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_loading_branches(inputs)
	return en_loading_branches(inputs)
});