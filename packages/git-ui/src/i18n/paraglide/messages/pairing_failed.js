/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Pairing_FailedInputs */

const en_pairing_failed = /** @type {(inputs: Pairing_FailedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Pairing failed`)
};

const zh_pairing_failed = /** @type {(inputs: Pairing_FailedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`配对失败`)
};

/**
* | output |
* | --- |
* | "Pairing failed" |
*
* @param {Pairing_FailedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pairing_failed = /** @type {((inputs?: Pairing_FailedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Pairing_FailedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_pairing_failed(inputs)
	return en_pairing_failed(inputs)
});