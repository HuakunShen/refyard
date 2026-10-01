/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Common_DeleteInputs */

const en_common_delete = /** @type {(inputs: Common_DeleteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Delete`)
};

const zh_common_delete = /** @type {(inputs: Common_DeleteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`删除`)
};

/**
* | output |
* | --- |
* | "Delete" |
*
* @param {Common_DeleteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_delete = /** @type {((inputs?: Common_DeleteInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Common_DeleteInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_common_delete(inputs)
	return en_common_delete(inputs)
});