/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} History_ClearInputs */

const en_history_clear = /** @type {(inputs: History_ClearInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Clear`)
};

const zh_history_clear = /** @type {(inputs: History_ClearInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`清除`)
};

/**
* | output |
* | --- |
* | "Clear" |
*
* @param {History_ClearInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const history_clear = /** @type {((inputs?: History_ClearInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<History_ClearInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_history_clear(inputs)
	return en_history_clear(inputs)
});