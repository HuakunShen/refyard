/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Update_AvailableInputs */

const en_update_available = /** @type {(inputs: Update_AvailableInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`An update is available`)
};

const zh_update_available = /** @type {(inputs: Update_AvailableInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`有可用更新`)
};

/**
* | output |
* | --- |
* | "An update is available" |
*
* @param {Update_AvailableInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const update_available = /** @type {((inputs?: Update_AvailableInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Update_AvailableInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_update_available(inputs)
	return en_update_available(inputs)
});