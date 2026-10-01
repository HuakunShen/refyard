/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_DiffInputs */

const en_commit_diff = /** @type {(inputs: Commit_DiffInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Commit diff`)
};

const zh_commit_diff = /** @type {(inputs: Commit_DiffInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`提交差异`)
};

/**
* | output |
* | --- |
* | "Commit diff" |
*
* @param {Commit_DiffInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_diff = /** @type {((inputs?: Commit_DiffInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_DiffInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_diff(inputs)
	return en_commit_diff(inputs)
});