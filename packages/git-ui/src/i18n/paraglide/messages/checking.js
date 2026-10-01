/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} CheckingInputs */

const en_checking = /** @type {(inputs: CheckingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Checking…`)
};

const zh_checking = /** @type {(inputs: CheckingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`检查中…`)
};

/**
* | output |
* | --- |
* | "Checking…" |
*
* @param {CheckingInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const checking = /** @type {((inputs?: CheckingInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<CheckingInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_checking(inputs)
	return en_checking(inputs)
});