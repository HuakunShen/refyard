/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} ChoosingInputs */

const en_choosing = /** @type {(inputs: ChoosingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Choosing…`)
};

const zh_choosing = /** @type {(inputs: ChoosingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`选择中…`)
};

/**
* | output |
* | --- |
* | "Choosing…" |
*
* @param {ChoosingInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const choosing = /** @type {((inputs?: ChoosingInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<ChoosingInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_choosing(inputs)
	return en_choosing(inputs)
});