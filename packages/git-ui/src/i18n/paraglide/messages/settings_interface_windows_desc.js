/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Interface_Windows_DescInputs */

const en_settings_interface_windows_desc = /** @type {(inputs: Settings_Interface_Windows_DescInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Fluent style · accent blue`)
};

const zh_settings_interface_windows_desc = /** @type {(inputs: Settings_Interface_Windows_DescInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Fluent 风格 · 强调蓝`)
};

/**
* | output |
* | --- |
* | "Fluent style · accent blue" |
*
* @param {Settings_Interface_Windows_DescInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_interface_windows_desc = /** @type {((inputs?: Settings_Interface_Windows_DescInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Interface_Windows_DescInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_interface_windows_desc(inputs)
	return en_settings_interface_windows_desc(inputs)
});