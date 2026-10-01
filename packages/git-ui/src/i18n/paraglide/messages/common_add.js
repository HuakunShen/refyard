/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Common_AddInputs */

const en_common_add = /** @type {(inputs: Common_AddInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Add`)
};

const zh_common_add = /** @type {(inputs: Common_AddInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`添加`)
};

/**
* | output |
* | --- |
* | "Add" |
*
* @param {Common_AddInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_add = /** @type {((inputs?: Common_AddInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Common_AddInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_common_add(inputs)
	return en_common_add(inputs)
});