/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ value: NonNullable<unknown> }} Filter_BeforeInputs */

const en_filter_before = /** @type {(inputs: Filter_BeforeInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Before: ${i?.value}`)
};

const zh_filter_before = /** @type {(inputs: Filter_BeforeInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`之前:${i?.value}`)
};

/**
* | output |
* | --- |
* | "Before: {value}" |
*
* @param {Filter_BeforeInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filter_before = /** @type {((inputs: Filter_BeforeInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filter_BeforeInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filter_before(inputs)
	return en_filter_before(inputs)
});