/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Update_FailedInputs */

const en_update_failed = /** @type {(inputs: Update_FailedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`The update could not be installed`)
};

const zh_update_failed = /** @type {(inputs: Update_FailedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`更新未能安装`)
};

/**
* | output |
* | --- |
* | "The update could not be installed" |
*
* @param {Update_FailedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const update_failed = /** @type {((inputs?: Update_FailedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Update_FailedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_update_failed(inputs)
	return en_update_failed(inputs)
});