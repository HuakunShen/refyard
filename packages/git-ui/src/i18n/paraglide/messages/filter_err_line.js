/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ field: NonNullable<unknown> }} Filter_Err_LineInputs */

const en_filter_err_line = /** @type {(inputs: Filter_Err_LineInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`${i?.field} must be a single line of up to 512 characters`)
};

const zh_filter_err_line = /** @type {(inputs: Filter_Err_LineInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`${i?.field} 必须是单行且不超过 512 个字符`)
};

/**
* | output |
* | --- |
* | "{field} must be a single line of up to 512 characters" |
*
* @param {Filter_Err_LineInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filter_err_line = /** @type {((inputs: Filter_Err_LineInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filter_Err_LineInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filter_err_line(inputs)
	return en_filter_err_line(inputs)
});