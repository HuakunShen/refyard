/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Common_CancelInputs */

const en_common_cancel = /** @type {(inputs: Common_CancelInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Cancel`)
};

const zh_common_cancel = /** @type {(inputs: Common_CancelInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`取消`)
};

/**
* | output |
* | --- |
* | "Cancel" |
*
* @param {Common_CancelInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_cancel = /** @type {((inputs?: Common_CancelInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Common_CancelInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_common_cancel(inputs)
	return en_common_cancel(inputs)
});