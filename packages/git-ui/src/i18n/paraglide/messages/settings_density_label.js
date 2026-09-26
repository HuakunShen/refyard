/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Density_LabelInputs */

const en_settings_density_label = /** @type {(inputs: Settings_Density_LabelInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Density`)
};

const zh_settings_density_label = /** @type {(inputs: Settings_Density_LabelInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`密度`)
};

/**
* | output |
* | --- |
* | "Density" |
*
* @param {Settings_Density_LabelInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_density_label = /** @type {((inputs?: Settings_Density_LabelInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Density_LabelInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_density_label(inputs)
	return en_settings_density_label(inputs)
});