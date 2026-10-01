/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Filters_RefInputs */

const en_filters_ref = /** @type {(inputs: Filters_RefInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Ref`)
};

const zh_filters_ref = /** @type {(inputs: Filters_RefInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`引用`)
};

/**
* | output |
* | --- |
* | "Ref" |
*
* @param {Filters_RefInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_ref = /** @type {((inputs?: Filters_RefInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filters_RefInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filters_ref(inputs)
	return en_filters_ref(inputs)
});