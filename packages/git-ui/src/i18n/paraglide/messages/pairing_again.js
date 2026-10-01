/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Pairing_AgainInputs */

const en_pairing_again = /** @type {(inputs: Pairing_AgainInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Pair again`)
};

const zh_pairing_again = /** @type {(inputs: Pairing_AgainInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`重新配对`)
};

/**
* | output |
* | --- |
* | "Pair again" |
*
* @param {Pairing_AgainInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pairing_again = /** @type {((inputs?: Pairing_AgainInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Pairing_AgainInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_pairing_again(inputs)
	return en_pairing_again(inputs)
});