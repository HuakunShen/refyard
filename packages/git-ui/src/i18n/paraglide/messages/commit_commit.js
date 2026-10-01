/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_CommitInputs */

const en_commit_commit = /** @type {(inputs: Commit_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Commit`)
};

const zh_commit_commit = /** @type {(inputs: Commit_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`提交`)
};

/**
* | output |
* | --- |
* | "Commit" |
*
* @param {Commit_CommitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_commit = /** @type {((inputs?: Commit_CommitInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_CommitInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_commit(inputs)
	return en_commit_commit(inputs)
});