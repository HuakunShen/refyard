/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} History_Column_DateInputs */

const en_history_column_date = /** @type {(inputs: History_Column_DateInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Date / Time`)
};

const zh_history_column_date = /** @type {(inputs: History_Column_DateInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`日期 / 时间`)
};

/**
* | output |
* | --- |
* | "Date / Time" |
*
* @param {History_Column_DateInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const history_column_date = /** @type {((inputs?: History_Column_DateInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<History_Column_DateInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_history_column_date(inputs)
	return en_history_column_date(inputs)
});