/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Common_CloseInputs */

const en_common_close = /** @type {(inputs: Common_CloseInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Close`)
};

const zh_common_close = /** @type {(inputs: Common_CloseInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`关闭`)
};

/**
* | output |
* | --- |
* | "Close" |
*
* @param {Common_CloseInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_close = /** @type {((inputs?: Common_CloseInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Common_CloseInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_common_close(inputs)
	return en_common_close(inputs)
});