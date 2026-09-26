/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} History_ApplyInputs */

const en_history_apply = /** @type {(inputs: History_ApplyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Apply`)
};

const zh_history_apply = /** @type {(inputs: History_ApplyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`应用`)
};

/**
* | output |
* | --- |
* | "Apply" |
*
* @param {History_ApplyInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const history_apply = /** @type {((inputs?: History_ApplyInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<History_ApplyInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_history_apply(inputs)
	return en_history_apply(inputs)
});