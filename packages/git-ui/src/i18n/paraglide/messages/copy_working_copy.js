/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Copy_Working_CopyInputs */

const en_copy_working_copy = /** @type {(inputs: Copy_Working_CopyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Working copy`)
};

const zh_copy_working_copy = /** @type {(inputs: Copy_Working_CopyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`工作副本`)
};

/**
* | output |
* | --- |
* | "Working copy" |
*
* @param {Copy_Working_CopyInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_working_copy = /** @type {((inputs?: Copy_Working_CopyInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Copy_Working_CopyInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_copy_working_copy(inputs)
	return en_copy_working_copy(inputs)
});