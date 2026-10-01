/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Detail_ParentsInputs */

const en_detail_parents = /** @type {(inputs: Detail_ParentsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`parents`)
};

const zh_detail_parents = /** @type {(inputs: Detail_ParentsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`父提交`)
};

/**
* | output |
* | --- |
* | "parents" |
*
* @param {Detail_ParentsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const detail_parents = /** @type {((inputs?: Detail_ParentsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Detail_ParentsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_detail_parents(inputs)
	return en_detail_parents(inputs)
});