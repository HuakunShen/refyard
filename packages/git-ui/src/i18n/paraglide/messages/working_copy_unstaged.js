/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Working_Copy_UnstagedInputs */

const en_working_copy_unstaged = /** @type {(inputs: Working_Copy_UnstagedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Unstaged Files`)
};

const zh_working_copy_unstaged = /** @type {(inputs: Working_Copy_UnstagedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`未暂存的文件`)
};

/**
* | output |
* | --- |
* | "Unstaged Files" |
*
* @param {Working_Copy_UnstagedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working_copy_unstaged = /** @type {((inputs?: Working_Copy_UnstagedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Working_Copy_UnstagedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_working_copy_unstaged(inputs)
	return en_working_copy_unstaged(inputs)
});