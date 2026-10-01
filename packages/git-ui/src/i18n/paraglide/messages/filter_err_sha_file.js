/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Filter_Err_Sha_FileInputs */

const en_filter_err_sha_file = /** @type {(inputs: Filter_Err_Sha_FileInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`SHA and file filters cannot be combined`)
};

const zh_filter_err_sha_file = /** @type {(inputs: Filter_Err_Sha_FileInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`SHA 与文件筛选不能同时使用`)
};

/**
* | output |
* | --- |
* | "SHA and file filters cannot be combined" |
*
* @param {Filter_Err_Sha_FileInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filter_err_sha_file = /** @type {((inputs?: Filter_Err_Sha_FileInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filter_Err_Sha_FileInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filter_err_sha_file(inputs)
	return en_filter_err_sha_file(inputs)
});