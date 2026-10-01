/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Detail_EncodingInputs */

const en_detail_encoding = /** @type {(inputs: Detail_EncodingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`encoding`)
};

const zh_detail_encoding = /** @type {(inputs: Detail_EncodingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`编码`)
};

/**
* | output |
* | --- |
* | "encoding" |
*
* @param {Detail_EncodingInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const detail_encoding = /** @type {((inputs?: Detail_EncodingInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Detail_EncodingInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_detail_encoding(inputs)
	return en_detail_encoding(inputs)
});