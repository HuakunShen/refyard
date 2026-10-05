/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Interface_MacosInputs */

const en_settings_interface_macos = /** @type {(inputs: Settings_Interface_MacosInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`macOS`)
};

const zh_settings_interface_macos = /** @type {(inputs: Settings_Interface_MacosInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`macOS`)
};

/**
* | output |
* | --- |
* | "macOS" |
*
* @param {Settings_Interface_MacosInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_interface_macos = /** @type {((inputs?: Settings_Interface_MacosInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Interface_MacosInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_interface_macos(inputs)
	return en_settings_interface_macos(inputs)
});