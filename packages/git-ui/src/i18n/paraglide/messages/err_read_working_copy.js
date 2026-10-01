/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Err_Read_Working_CopyInputs */

const en_err_read_working_copy = /** @type {(inputs: Err_Read_Working_CopyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Could not read working copy`)
};

const zh_err_read_working_copy = /** @type {(inputs: Err_Read_Working_CopyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`无法读取工作副本`)
};

/**
* | output |
* | --- |
* | "Could not read working copy" |
*
* @param {Err_Read_Working_CopyInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const err_read_working_copy = /** @type {((inputs?: Err_Read_Working_CopyInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Err_Read_Working_CopyInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_err_read_working_copy(inputs)
	return en_err_read_working_copy(inputs)
});