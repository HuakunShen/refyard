/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Filters_Sha_PlaceholderInputs */

const en_filters_sha_placeholder = /** @type {(inputs: Filters_Sha_PlaceholderInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`At least 4 hex digits`)
};

const zh_filters_sha_placeholder = /** @type {(inputs: Filters_Sha_PlaceholderInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`至少 4 位十六进制`)
};

/**
* | output |
* | --- |
* | "At least 4 hex digits" |
*
* @param {Filters_Sha_PlaceholderInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_sha_placeholder = /** @type {((inputs?: Filters_Sha_PlaceholderInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filters_Sha_PlaceholderInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filters_sha_placeholder(inputs)
	return en_filters_sha_placeholder(inputs)
});