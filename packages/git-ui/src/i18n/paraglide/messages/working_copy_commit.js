/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Working_Copy_CommitInputs */

const en_working_copy_commit = /** @type {(inputs: Working_Copy_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Commit`)
};

const zh_working_copy_commit = /** @type {(inputs: Working_Copy_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`提交`)
};

/**
* | output |
* | --- |
* | "Commit" |
*
* @param {Working_Copy_CommitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working_copy_commit = /** @type {((inputs?: Working_Copy_CommitInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Working_Copy_CommitInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_working_copy_commit(inputs)
	return en_working_copy_commit(inputs)
});