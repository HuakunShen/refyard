/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Filters_Applied_AriaInputs */

const en_filters_applied_aria = /** @type {(inputs: Filters_Applied_AriaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Applied history filters`)
};

const zh_filters_applied_aria = /** @type {(inputs: Filters_Applied_AriaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`已应用的历史筛选`)
};

/**
* | output |
* | --- |
* | "Applied history filters" |
*
* @param {Filters_Applied_AriaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_applied_aria = /** @type {((inputs?: Filters_Applied_AriaInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filters_Applied_AriaInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filters_applied_aria(inputs)
	return en_filters_applied_aria(inputs)
});