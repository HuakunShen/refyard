/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_AppearanceInputs */

const en_settings_appearance = /** @type {(inputs: Settings_AppearanceInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Appearance`)
};

const zh_settings_appearance = /** @type {(inputs: Settings_AppearanceInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`外观`)
};

/**
* | output |
* | --- |
* | "Appearance" |
*
* @param {Settings_AppearanceInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_appearance = /** @type {((inputs?: Settings_AppearanceInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_AppearanceInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_appearance(inputs)
	return en_settings_appearance(inputs)
});