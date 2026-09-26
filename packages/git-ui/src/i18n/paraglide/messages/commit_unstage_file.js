/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_Unstage_FileInputs */

const en_commit_unstage_file = /** @type {(inputs: Commit_Unstage_FileInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Unstage file`)
};

const zh_commit_unstage_file = /** @type {(inputs: Commit_Unstage_FileInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`取消暂存`)
};

/**
* | output |
* | --- |
* | "Unstage file" |
*
* @param {Commit_Unstage_FileInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_unstage_file = /** @type {((inputs?: Commit_Unstage_FileInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_Unstage_FileInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_unstage_file(inputs)
	return en_commit_unstage_file(inputs)
});