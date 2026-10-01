/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} AcknowledgingInputs */

const en_acknowledging = /** @type {(inputs: AcknowledgingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Acknowledging…`)
};

const zh_acknowledging = /** @type {(inputs: AcknowledgingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`确认中…`)
};

/**
* | output |
* | --- |
* | "Acknowledging…" |
*
* @param {AcknowledgingInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const acknowledging = /** @type {((inputs?: AcknowledgingInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<AcknowledgingInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_acknowledging(inputs)
	return en_acknowledging(inputs)
});