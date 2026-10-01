/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Detail_CommittedInputs */

const en_detail_committed = /** @type {(inputs: Detail_CommittedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`committed`)
};

const zh_detail_committed = /** @type {(inputs: Detail_CommittedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`提交于`)
};

/**
* | output |
* | --- |
* | "committed" |
*
* @param {Detail_CommittedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const detail_committed = /** @type {((inputs?: Detail_CommittedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Detail_CommittedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_detail_committed(inputs)
	return en_detail_committed(inputs)
});