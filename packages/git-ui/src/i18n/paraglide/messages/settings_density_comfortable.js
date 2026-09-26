/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Density_ComfortableInputs */

const en_settings_density_comfortable = /** @type {(inputs: Settings_Density_ComfortableInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`36px rows — the middle size`)
};

const zh_settings_density_comfortable = /** @type {(inputs: Settings_Density_ComfortableInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`36px 行 —— 中等`)
};

/**
* | output |
* | --- |
* | "36px rows — the middle size" |
*
* @param {Settings_Density_ComfortableInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_density_comfortable = /** @type {((inputs?: Settings_Density_ComfortableInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Density_ComfortableInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_density_comfortable(inputs)
	return en_settings_density_comfortable(inputs)
});