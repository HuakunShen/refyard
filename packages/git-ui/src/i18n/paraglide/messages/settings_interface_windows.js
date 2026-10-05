/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Interface_WindowsInputs */

const en_settings_interface_windows = /** @type {(inputs: Settings_Interface_WindowsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Windows`)
};

const zh_settings_interface_windows = /** @type {(inputs: Settings_Interface_WindowsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Windows`)
};

/**
* | output |
* | --- |
* | "Windows" |
*
* @param {Settings_Interface_WindowsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_interface_windows = /** @type {((inputs?: Settings_Interface_WindowsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Interface_WindowsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_interface_windows(inputs)
	return en_settings_interface_windows(inputs)
});