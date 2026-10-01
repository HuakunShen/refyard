/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Branch_UpstreamInputs */

const en_branch_upstream = /** @type {(inputs: Branch_UpstreamInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Upstream…`)
};

const zh_branch_upstream = /** @type {(inputs: Branch_UpstreamInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`上游…`)
};

/**
* | output |
* | --- |
* | "Upstream…" |
*
* @param {Branch_UpstreamInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_upstream = /** @type {((inputs?: Branch_UpstreamInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Branch_UpstreamInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_branch_upstream(inputs)
	return en_branch_upstream(inputs)
});