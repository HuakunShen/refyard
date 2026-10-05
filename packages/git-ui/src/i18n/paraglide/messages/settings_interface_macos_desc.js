/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Interface_Macos_DescInputs */

const en_settings_interface_macos_desc = /** @type {(inputs: Settings_Interface_Macos_DescInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`System type · translucent chrome`)
};

const zh_settings_interface_macos_desc = /** @type {(inputs: Settings_Interface_Macos_DescInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`系统字体 · 半透明质感`)
};

/**
* | output |
* | --- |
* | "System type · translucent chrome" |
*
* @param {Settings_Interface_Macos_DescInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_interface_macos_desc = /** @type {((inputs?: Settings_Interface_Macos_DescInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Interface_Macos_DescInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_interface_macos_desc(inputs)
	return en_settings_interface_macos_desc(inputs)
});