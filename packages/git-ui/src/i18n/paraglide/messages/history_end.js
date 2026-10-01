/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} History_EndInputs */

const en_history_end = /** @type {(inputs: History_EndInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`End of the loaded history`)
};

const zh_history_end = /** @type {(inputs: History_EndInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`已加载历史的末尾`)
};

/**
* | output |
* | --- |
* | "End of the loaded history" |
*
* @param {History_EndInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const history_end = /** @type {((inputs?: History_EndInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<History_EndInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_history_end(inputs)
	return en_history_end(inputs)
});