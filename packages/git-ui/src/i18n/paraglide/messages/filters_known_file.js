/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Filters_Known_FileInputs */

const en_filters_known_file = /** @type {(inputs: Filters_Known_FileInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Known file`)
};

const zh_filters_known_file = /** @type {(inputs: Filters_Known_FileInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`已知文件`)
};

/**
* | output |
* | --- |
* | "Known file" |
*
* @param {Filters_Known_FileInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_known_file = /** @type {((inputs?: Filters_Known_FileInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filters_Known_FileInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filters_known_file(inputs)
	return en_filters_known_file(inputs)
});