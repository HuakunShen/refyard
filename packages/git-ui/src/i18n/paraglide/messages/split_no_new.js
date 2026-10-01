/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Split_No_NewInputs */

const en_split_no_new = /** @type {(inputs: Split_No_NewInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No new line`)
};

const zh_split_no_new = /** @type {(inputs: Split_No_NewInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`无末尾换行`)
};

/**
* | output |
* | --- |
* | "No new line" |
*
* @param {Split_No_NewInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const split_no_new = /** @type {((inputs?: Split_No_NewInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Split_No_NewInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_split_no_new(inputs)
	return en_split_no_new(inputs)
});