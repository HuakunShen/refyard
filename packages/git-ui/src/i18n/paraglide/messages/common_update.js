/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Common_UpdateInputs */

const en_common_update = /** @type {(inputs: Common_UpdateInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Update`)
};

const zh_common_update = /** @type {(inputs: Common_UpdateInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`更新`)
};

/**
* | output |
* | --- |
* | "Update" |
*
* @param {Common_UpdateInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_update = /** @type {((inputs?: Common_UpdateInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Common_UpdateInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_common_update(inputs)
	return en_common_update(inputs)
});