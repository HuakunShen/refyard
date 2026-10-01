/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Copy_Resolve_FirstInputs */

const en_copy_resolve_first = /** @type {(inputs: Copy_Resolve_FirstInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Resolve conflicts first`)
};

const zh_copy_resolve_first = /** @type {(inputs: Copy_Resolve_FirstInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`请先解决冲突`)
};

/**
* | output |
* | --- |
* | "Resolve conflicts first" |
*
* @param {Copy_Resolve_FirstInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_resolve_first = /** @type {((inputs?: Copy_Resolve_FirstInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Copy_Resolve_FirstInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_copy_resolve_first(inputs)
	return en_copy_resolve_first(inputs)
});