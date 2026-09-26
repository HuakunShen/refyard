/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Density_RoomyInputs */

const en_settings_density_roomy = /** @type {(inputs: Settings_Density_RoomyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`44px rows — GitKraken's spacing`)
};

const zh_settings_density_roomy = /** @type {(inputs: Settings_Density_RoomyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`44px 行 —— GitKraken 的间距`)
};

/**
* | output |
* | --- |
* | "44px rows — GitKraken's spacing" |
*
* @param {Settings_Density_RoomyInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_density_roomy = /** @type {((inputs?: Settings_Density_RoomyInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Density_RoomyInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_density_roomy(inputs)
	return en_settings_density_roomy(inputs)
});