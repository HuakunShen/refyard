/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Copy_DiscardInputs */

const en_copy_discard = /** @type {(inputs: Copy_DiscardInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Discard…`)
};

const zh_copy_discard = /** @type {(inputs: Copy_DiscardInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`丢弃…`)
};

/**
* | output |
* | --- |
* | "Discard…" |
*
* @param {Copy_DiscardInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_discard = /** @type {((inputs?: Copy_DiscardInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Copy_DiscardInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_copy_discard(inputs)
	return en_copy_discard(inputs)
});