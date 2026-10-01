/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Detail_AuthorInputs */

const en_detail_author = /** @type {(inputs: Detail_AuthorInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`author`)
};

const zh_detail_author = /** @type {(inputs: Detail_AuthorInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`作者`)
};

/**
* | output |
* | --- |
* | "author" |
*
* @param {Detail_AuthorInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const detail_author = /** @type {((inputs?: Detail_AuthorInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Detail_AuthorInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_detail_author(inputs)
	return en_detail_author(inputs)
});