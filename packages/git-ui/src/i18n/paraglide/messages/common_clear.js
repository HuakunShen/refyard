/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Common_ClearInputs */

const en_common_clear = /** @type {(inputs: Common_ClearInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Clear`)
};

const zh_common_clear = /** @type {(inputs: Common_ClearInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`清除`)
};

/**
* | output |
* | --- |
* | "Clear" |
*
* @param {Common_ClearInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_clear = /** @type {((inputs?: Common_ClearInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Common_ClearInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_common_clear(inputs)
	return en_common_clear(inputs)
});