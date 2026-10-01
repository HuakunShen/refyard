/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Bg_SolidInputs */

const en_bg_solid = /** @type {(inputs: Bg_SolidInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Solid Canvas`)
};

const zh_bg_solid = /** @type {(inputs: Bg_SolidInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`纯色画布`)
};

/**
* | output |
* | --- |
* | "Solid Canvas" |
*
* @param {Bg_SolidInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const bg_solid = /** @type {((inputs?: Bg_SolidInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Bg_SolidInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_bg_solid(inputs)
	return en_bg_solid(inputs)
});