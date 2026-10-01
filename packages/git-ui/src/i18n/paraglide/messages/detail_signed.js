/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Detail_SignedInputs */

const en_detail_signed = /** @type {(inputs: Detail_SignedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`signed`)
};

const zh_detail_signed = /** @type {(inputs: Detail_SignedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`已签名`)
};

/**
* | output |
* | --- |
* | "signed" |
*
* @param {Detail_SignedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const detail_signed = /** @type {((inputs?: Detail_SignedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Detail_SignedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_detail_signed(inputs)
	return en_detail_signed(inputs)
});