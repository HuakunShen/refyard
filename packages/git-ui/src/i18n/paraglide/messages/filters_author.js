/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Filters_AuthorInputs */

const en_filters_author = /** @type {(inputs: Filters_AuthorInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Author`)
};

const zh_filters_author = /** @type {(inputs: Filters_AuthorInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`作者`)
};

/**
* | output |
* | --- |
* | "Author" |
*
* @param {Filters_AuthorInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_author = /** @type {((inputs?: Filters_AuthorInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filters_AuthorInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filters_author(inputs)
	return en_filters_author(inputs)
});