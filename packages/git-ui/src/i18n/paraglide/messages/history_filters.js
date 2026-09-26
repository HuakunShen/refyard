/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} History_FiltersInputs */

const en_history_filters = /** @type {(inputs: History_FiltersInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Filters`)
};

const zh_history_filters = /** @type {(inputs: History_FiltersInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`筛选`)
};

/**
* | output |
* | --- |
* | "Filters" |
*
* @param {History_FiltersInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const history_filters = /** @type {((inputs?: History_FiltersInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<History_FiltersInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_history_filters(inputs)
	return en_history_filters(inputs)
});