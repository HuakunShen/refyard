/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Detail_CommitterInputs */

const en_detail_committer = /** @type {(inputs: Detail_CommitterInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`committer`)
};

const zh_detail_committer = /** @type {(inputs: Detail_CommitterInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`提交者`)
};

/**
* | output |
* | --- |
* | "committer" |
*
* @param {Detail_CommitterInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const detail_committer = /** @type {((inputs?: Detail_CommitterInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Detail_CommitterInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_detail_committer(inputs)
	return en_detail_committer(inputs)
});