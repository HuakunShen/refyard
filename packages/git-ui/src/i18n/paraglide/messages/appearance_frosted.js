/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Appearance_FrostedInputs */

const en_appearance_frosted = /** @type {(inputs: Appearance_FrostedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Frosted Glass Effect`)
};

const zh_appearance_frosted = /** @type {(inputs: Appearance_FrostedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`毛玻璃效果`)
};

/**
* | output |
* | --- |
* | "Frosted Glass Effect" |
*
* @param {Appearance_FrostedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_frosted = /** @type {((inputs?: Appearance_FrostedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Appearance_FrostedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_appearance_frosted(inputs)
	return en_appearance_frosted(inputs)
});