/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Reset_Mixed_HintInputs */

const en_reset_mixed_hint = /** @type {(inputs: Reset_Mixed_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Mixed — unstage changes`)
};

const zh_reset_mixed_hint = /** @type {(inputs: Reset_Mixed_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`混合 — 取消暂存变更`)
};

/**
* | output |
* | --- |
* | "Mixed — unstage changes" |
*
* @param {Reset_Mixed_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const reset_mixed_hint = /** @type {((inputs?: Reset_Mixed_HintInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Reset_Mixed_HintInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_reset_mixed_hint(inputs)
	return en_reset_mixed_hint(inputs)
});