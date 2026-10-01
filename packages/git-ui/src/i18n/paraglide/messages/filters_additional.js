/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Filters_AdditionalInputs */

const en_filters_additional = /** @type {(inputs: Filters_AdditionalInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Additional history filters`)
};

const zh_filters_additional = /** @type {(inputs: Filters_AdditionalInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`更多历史筛选`)
};

/**
* | output |
* | --- |
* | "Additional history filters" |
*
* @param {Filters_AdditionalInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_additional = /** @type {((inputs?: Filters_AdditionalInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filters_AdditionalInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filters_additional(inputs)
	return en_filters_additional(inputs)
});