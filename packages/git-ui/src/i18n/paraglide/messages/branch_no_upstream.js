/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Branch_No_UpstreamInputs */

const en_branch_no_upstream = /** @type {(inputs: Branch_No_UpstreamInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No upstream`)
};

const zh_branch_no_upstream = /** @type {(inputs: Branch_No_UpstreamInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`无上游`)
};

/**
* | output |
* | --- |
* | "No upstream" |
*
* @param {Branch_No_UpstreamInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_no_upstream = /** @type {((inputs?: Branch_No_UpstreamInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Branch_No_UpstreamInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_branch_no_upstream(inputs)
	return en_branch_no_upstream(inputs)
});