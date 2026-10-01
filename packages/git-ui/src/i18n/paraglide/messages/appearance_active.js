/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Appearance_ActiveInputs */

const en_appearance_active = /** @type {(inputs: Appearance_ActiveInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Active`)
};

const zh_appearance_active = /** @type {(inputs: Appearance_ActiveInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`启用`)
};

/**
* | output |
* | --- |
* | "Active" |
*
* @param {Appearance_ActiveInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_active = /** @type {((inputs?: Appearance_ActiveInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Appearance_ActiveInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_appearance_active(inputs)
	return en_appearance_active(inputs)
});