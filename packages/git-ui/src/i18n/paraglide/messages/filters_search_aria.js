/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Filters_Search_AriaInputs */

const en_filters_search_aria = /** @type {(inputs: Filters_Search_AriaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`History search`)
};

const zh_filters_search_aria = /** @type {(inputs: Filters_Search_AriaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`历史搜索`)
};

/**
* | output |
* | --- |
* | "History search" |
*
* @param {Filters_Search_AriaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_search_aria = /** @type {((inputs?: Filters_Search_AriaInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filters_Search_AriaInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filters_search_aria(inputs)
	return en_filters_search_aria(inputs)
});