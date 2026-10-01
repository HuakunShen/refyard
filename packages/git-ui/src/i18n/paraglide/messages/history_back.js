/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} History_BackInputs */

const en_history_back = /** @type {(inputs: History_BackInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Back to history`)
};

const zh_history_back = /** @type {(inputs: History_BackInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`返回历史`)
};

/**
* | output |
* | --- |
* | "Back to history" |
*
* @param {History_BackInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const history_back = /** @type {((inputs?: History_BackInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<History_BackInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_history_back(inputs)
	return en_history_back(inputs)
});