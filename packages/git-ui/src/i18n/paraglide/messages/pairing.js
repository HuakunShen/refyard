/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} PairingInputs */

const en_pairing = /** @type {(inputs: PairingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Pairing…`)
};

const zh_pairing = /** @type {(inputs: PairingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`配对中…`)
};

/**
* | output |
* | --- |
* | "Pairing…" |
*
* @param {PairingInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pairing = /** @type {((inputs?: PairingInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<PairingInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_pairing(inputs)
	return en_pairing(inputs)
});