/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Common_SaveInputs */

const en_common_save = /** @type {(inputs: Common_SaveInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Save`)
};

const zh_common_save = /** @type {(inputs: Common_SaveInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`保存`)
};

/**
* | output |
* | --- |
* | "Save" |
*
* @param {Common_SaveInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_save = /** @type {((inputs?: Common_SaveInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Common_SaveInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_common_save(inputs)
	return en_common_save(inputs)
});