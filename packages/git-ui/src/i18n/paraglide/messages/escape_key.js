/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Escape_KeyInputs */

const en_escape_key = /** @type {(inputs: Escape_KeyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Escape`)
};

const zh_escape_key = /** @type {(inputs: Escape_KeyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Esc`)
};

/**
* | output |
* | --- |
* | "Escape" |
*
* @param {Escape_KeyInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const escape_key = /** @type {((inputs?: Escape_KeyInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Escape_KeyInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_escape_key(inputs)
	return en_escape_key(inputs)
});