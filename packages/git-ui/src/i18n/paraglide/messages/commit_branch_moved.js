/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_Branch_MovedInputs */

const en_commit_branch_moved = /** @type {(inputs: Commit_Branch_MovedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`The branch moved while you were reading`)
};

const zh_commit_branch_moved = /** @type {(inputs: Commit_Branch_MovedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`阅读期间分支已移动`)
};

/**
* | output |
* | --- |
* | "The branch moved while you were reading" |
*
* @param {Commit_Branch_MovedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_branch_moved = /** @type {((inputs?: Commit_Branch_MovedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_Branch_MovedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_branch_moved(inputs)
	return en_commit_branch_moved(inputs)
});