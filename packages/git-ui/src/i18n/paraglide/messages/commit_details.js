/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_DetailsInputs */

const en_commit_details = /** @type {(inputs: Commit_DetailsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Commit details`)
};

const zh_commit_details = /** @type {(inputs: Commit_DetailsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`提交详情`)
};

/**
* | output |
* | --- |
* | "Commit details" |
*
* @param {Commit_DetailsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_details = /** @type {((inputs?: Commit_DetailsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_DetailsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_details(inputs)
	return en_commit_details(inputs)
});