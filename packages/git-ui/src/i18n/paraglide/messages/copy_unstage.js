/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Copy_UnstageInputs */

const en_copy_unstage = /** @type {(inputs: Copy_UnstageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Unstage`)
};

const zh_copy_unstage = /** @type {(inputs: Copy_UnstageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`取消暂存`)
};

/**
* | output |
* | --- |
* | "Unstage" |
*
* @param {Copy_UnstageInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_unstage = /** @type {((inputs?: Copy_UnstageInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Copy_UnstageInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_copy_unstage(inputs)
	return en_copy_unstage(inputs)
});