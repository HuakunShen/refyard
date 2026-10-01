/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Filter_Field_AuthorInputs */

const en_filter_field_author = /** @type {(inputs: Filter_Field_AuthorInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Author`)
};

const zh_filter_field_author = /** @type {(inputs: Filter_Field_AuthorInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`作者`)
};

/**
* | output |
* | --- |
* | "Author" |
*
* @param {Filter_Field_AuthorInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filter_field_author = /** @type {((inputs?: Filter_Field_AuthorInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filter_Field_AuthorInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filter_field_author(inputs)
	return en_filter_field_author(inputs)
});