/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Detail_AuthoredInputs */

const en_detail_authored = /** @type {(inputs: Detail_AuthoredInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`authored`)
};

const zh_detail_authored = /** @type {(inputs: Detail_AuthoredInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`撰写于`)
};

/**
* | output |
* | --- |
* | "authored" |
*
* @param {Detail_AuthoredInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const detail_authored = /** @type {((inputs?: Detail_AuthoredInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Detail_AuthoredInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_detail_authored(inputs)
	return en_detail_authored(inputs)
});