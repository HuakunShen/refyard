/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Split_No_OldInputs */

const en_split_no_old = /** @type {(inputs: Split_No_OldInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No old line`)
};

const zh_split_no_old = /** @type {(inputs: Split_No_OldInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`无旧行`)
};

/**
* | output |
* | --- |
* | "No old line" |
*
* @param {Split_No_OldInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const split_no_old = /** @type {((inputs?: Split_No_OldInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Split_No_OldInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_split_no_old(inputs)
	return en_split_no_old(inputs)
});