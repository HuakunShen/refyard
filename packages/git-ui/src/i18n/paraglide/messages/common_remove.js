/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Common_RemoveInputs */

const en_common_remove = /** @type {(inputs: Common_RemoveInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Remove`)
};

const zh_common_remove = /** @type {(inputs: Common_RemoveInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`移除`)
};

/**
* | output |
* | --- |
* | "Remove" |
*
* @param {Common_RemoveInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_remove = /** @type {((inputs?: Common_RemoveInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Common_RemoveInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_common_remove(inputs)
	return en_common_remove(inputs)
});