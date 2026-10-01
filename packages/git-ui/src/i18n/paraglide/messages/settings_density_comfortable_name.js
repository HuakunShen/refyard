/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Density_Comfortable_NameInputs */

const en_settings_density_comfortable_name = /** @type {(inputs: Settings_Density_Comfortable_NameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Comfortable`)
};

const zh_settings_density_comfortable_name = /** @type {(inputs: Settings_Density_Comfortable_NameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`舒适`)
};

/**
* | output |
* | --- |
* | "Comfortable" |
*
* @param {Settings_Density_Comfortable_NameInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_density_comfortable_name = /** @type {((inputs?: Settings_Density_Comfortable_NameInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Density_Comfortable_NameInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_density_comfortable_name(inputs)
	return en_settings_density_comfortable_name(inputs)
});