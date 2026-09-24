/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} History_ReadingInputs */

const en_history_reading = /** @type {(inputs: History_ReadingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Reading history…`)
};

const zh_history_reading = /** @type {(inputs: History_ReadingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`正在读取历史…`)
};

/**
* | output |
* | --- |
* | "Reading history…" |
*
* @param {History_ReadingInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const history_reading = /** @type {((inputs?: History_ReadingInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<History_ReadingInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_history_reading(inputs)
	return en_history_reading(inputs)
});