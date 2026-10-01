/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Reset_Soft_HintInputs */

const en_reset_soft_hint = /** @type {(inputs: Reset_Soft_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Soft — keep everything staged`)
};

const zh_reset_soft_hint = /** @type {(inputs: Reset_Soft_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`软重置 — 保留所有已暂存`)
};

/**
* | output |
* | --- |
* | "Soft — keep everything staged" |
*
* @param {Reset_Soft_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const reset_soft_hint = /** @type {((inputs?: Reset_Soft_HintInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Reset_Soft_HintInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_reset_soft_hint(inputs)
	return en_reset_soft_hint(inputs)
});