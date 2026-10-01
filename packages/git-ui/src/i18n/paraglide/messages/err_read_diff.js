/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Err_Read_DiffInputs */

const en_err_read_diff = /** @type {(inputs: Err_Read_DiffInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Could not read diff`)
};

const zh_err_read_diff = /** @type {(inputs: Err_Read_DiffInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`无法读取差异`)
};

/**
* | output |
* | --- |
* | "Could not read diff" |
*
* @param {Err_Read_DiffInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const err_read_diff = /** @type {((inputs?: Err_Read_DiffInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Err_Read_DiffInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_err_read_diff(inputs)
	return en_err_read_diff(inputs)
});