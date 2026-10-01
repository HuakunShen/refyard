/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Filters_Commit_ShaInputs */

const en_filters_commit_sha = /** @type {(inputs: Filters_Commit_ShaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Commit SHA`)
};

const zh_filters_commit_sha = /** @type {(inputs: Filters_Commit_ShaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`提交 SHA`)
};

/**
* | output |
* | --- |
* | "Commit SHA" |
*
* @param {Filters_Commit_ShaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_commit_sha = /** @type {((inputs?: Filters_Commit_ShaInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filters_Commit_ShaInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filters_commit_sha(inputs)
	return en_filters_commit_sha(inputs)
});