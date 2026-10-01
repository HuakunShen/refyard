/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Appearance_AccentInputs */

const en_appearance_accent = /** @type {(inputs: Appearance_AccentInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Accent Color`)
};

const zh_appearance_accent = /** @type {(inputs: Appearance_AccentInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`强调色`)
};

/**
* | output |
* | --- |
* | "Accent Color" |
*
* @param {Appearance_AccentInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_accent = /** @type {((inputs?: Appearance_AccentInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Appearance_AccentInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_appearance_accent(inputs)
	return en_appearance_accent(inputs)
});