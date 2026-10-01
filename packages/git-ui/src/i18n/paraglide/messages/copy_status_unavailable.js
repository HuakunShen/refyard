/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Copy_Status_UnavailableInputs */

const en_copy_status_unavailable = /** @type {(inputs: Copy_Status_UnavailableInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Status unavailable`)
};

const zh_copy_status_unavailable = /** @type {(inputs: Copy_Status_UnavailableInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`状态不可用`)
};

/**
* | output |
* | --- |
* | "Status unavailable" |
*
* @param {Copy_Status_UnavailableInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_status_unavailable = /** @type {((inputs?: Copy_Status_UnavailableInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Copy_Status_UnavailableInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_copy_status_unavailable(inputs)
	return en_copy_status_unavailable(inputs)
});