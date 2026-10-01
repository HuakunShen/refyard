/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} No_Matching_CommitsInputs */

const en_no_matching_commits = /** @type {(inputs: No_Matching_CommitsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No matching commits`)
};

const zh_no_matching_commits = /** @type {(inputs: No_Matching_CommitsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`没有匹配的提交`)
};

/**
* | output |
* | --- |
* | "No matching commits" |
*
* @param {No_Matching_CommitsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const no_matching_commits = /** @type {((inputs?: No_Matching_CommitsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<No_Matching_CommitsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_no_matching_commits(inputs)
	return en_no_matching_commits(inputs)
});