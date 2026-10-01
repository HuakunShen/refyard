/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Revert_CommitInputs */

const en_revert_commit = /** @type {(inputs: Revert_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Revert commit`)
};

const zh_revert_commit = /** @type {(inputs: Revert_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`还原提交`)
};

/**
* | output |
* | --- |
* | "Revert commit" |
*
* @param {Revert_CommitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const revert_commit = /** @type {((inputs?: Revert_CommitInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Revert_CommitInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_revert_commit(inputs)
	return en_revert_commit(inputs)
});