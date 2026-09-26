/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Working_Copy_Commit_MessageInputs */

const en_working_copy_commit_message = /** @type {(inputs: Working_Copy_Commit_MessageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Commit message`)
};

const zh_working_copy_commit_message = /** @type {(inputs: Working_Copy_Commit_MessageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`提交信息`)
};

/**
* | output |
* | --- |
* | "Commit message" |
*
* @param {Working_Copy_Commit_MessageInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working_copy_commit_message = /** @type {((inputs?: Working_Copy_Commit_MessageInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Working_Copy_Commit_MessageInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_working_copy_commit_message(inputs)
	return en_working_copy_commit_message(inputs)
});