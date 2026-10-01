/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Detail_TreeInputs */

const en_detail_tree = /** @type {(inputs: Detail_TreeInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`tree`)
};

const zh_detail_tree = /** @type {(inputs: Detail_TreeInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`目录树`)
};

/**
* | output |
* | --- |
* | "tree" |
*
* @param {Detail_TreeInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const detail_tree = /** @type {((inputs?: Detail_TreeInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Detail_TreeInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_detail_tree(inputs)
	return en_detail_tree(inputs)
});