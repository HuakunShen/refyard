/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Err_Read_HistoryInputs */

const en_err_read_history = /** @type {(inputs: Err_Read_HistoryInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Could not read history`)
};

const zh_err_read_history = /** @type {(inputs: Err_Read_HistoryInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`无法读取历史`)
};

/**
* | output |
* | --- |
* | "Could not read history" |
*
* @param {Err_Read_HistoryInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const err_read_history = /** @type {((inputs?: Err_Read_HistoryInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Err_Read_HistoryInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_err_read_history(inputs)
	return en_err_read_history(inputs)
});