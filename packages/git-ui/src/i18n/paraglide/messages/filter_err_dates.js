/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Filter_Err_DatesInputs */

const en_filter_err_dates = /** @type {(inputs: Filter_Err_DatesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Use valid UTC dates with the start no later than the end`)
};

const zh_filter_err_dates = /** @type {(inputs: Filter_Err_DatesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`请使用有效的 UTC 日期,且开始时间不得晚于结束时间`)
};

/**
* | output |
* | --- |
* | "Use valid UTC dates with the start no later than the end" |
*
* @param {Filter_Err_DatesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filter_err_dates = /** @type {((inputs?: Filter_Err_DatesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filter_Err_DatesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filter_err_dates(inputs)
	return en_filter_err_dates(inputs)
});