/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ value: NonNullable<unknown> }} Filter_AfterInputs */

const en_filter_after = /** @type {(inputs: Filter_AfterInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`After: ${i?.value}`)
};

const zh_filter_after = /** @type {(inputs: Filter_AfterInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`之后:${i?.value}`)
};

/**
* | output |
* | --- |
* | "After: {value}" |
*
* @param {Filter_AfterInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filter_after = /** @type {((inputs: Filter_AfterInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filter_AfterInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filter_after(inputs)
	return en_filter_after(inputs)
});