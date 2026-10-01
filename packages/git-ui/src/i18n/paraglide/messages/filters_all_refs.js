/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Filters_All_RefsInputs */

const en_filters_all_refs = /** @type {(inputs: Filters_All_RefsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`All refs`)
};

const zh_filters_all_refs = /** @type {(inputs: Filters_All_RefsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`全部引用`)
};

/**
* | output |
* | --- |
* | "All refs" |
*
* @param {Filters_All_RefsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_all_refs = /** @type {((inputs?: Filters_All_RefsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filters_All_RefsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filters_all_refs(inputs)
	return en_filters_all_refs(inputs)
});