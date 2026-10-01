/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Diff_UnifiedInputs */

const en_diff_unified = /** @type {(inputs: Diff_UnifiedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Unified`)
};

const zh_diff_unified = /** @type {(inputs: Diff_UnifiedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`统一`)
};

/**
* | output |
* | --- |
* | "Unified" |
*
* @param {Diff_UnifiedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const diff_unified = /** @type {((inputs?: Diff_UnifiedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Diff_UnifiedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_diff_unified(inputs)
	return en_diff_unified(inputs)
});