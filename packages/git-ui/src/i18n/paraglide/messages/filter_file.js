/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ name: NonNullable<unknown> }} Filter_FileInputs */

const en_filter_file = /** @type {(inputs: Filter_FileInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`File: ${i?.name}`)
};

const zh_filter_file = /** @type {(inputs: Filter_FileInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`文件:${i?.name}`)
};

/**
* | output |
* | --- |
* | "File: {name}" |
*
* @param {Filter_FileInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filter_file = /** @type {((inputs: Filter_FileInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filter_FileInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filter_file(inputs)
	return en_filter_file(inputs)
});