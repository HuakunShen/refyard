/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_DensityInputs */

const en_settings_density = /** @type {(inputs: Settings_DensityInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Row density`)
};

const zh_settings_density = /** @type {(inputs: Settings_DensityInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`行密度`)
};

/**
* | output |
* | --- |
* | "Row density" |
*
* @param {Settings_DensityInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_density = /** @type {((inputs?: Settings_DensityInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_DensityInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_density(inputs)
	return en_settings_density(inputs)
});