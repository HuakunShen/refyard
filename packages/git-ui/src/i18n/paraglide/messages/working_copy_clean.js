/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Working_Copy_CleanInputs */

const en_working_copy_clean = /** @type {(inputs: Working_Copy_CleanInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Working tree is clean.`)
};

const zh_working_copy_clean = /** @type {(inputs: Working_Copy_CleanInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`工作树是干净的。`)
};

/**
* | output |
* | --- |
* | "Working tree is clean." |
*
* @param {Working_Copy_CleanInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const working_copy_clean = /** @type {((inputs?: Working_Copy_CleanInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Working_Copy_CleanInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_working_copy_clean(inputs)
	return en_working_copy_clean(inputs)
});