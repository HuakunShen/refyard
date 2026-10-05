/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Interface_Linux_DescInputs */

const en_settings_interface_linux_desc = /** @type {(inputs: Settings_Interface_Linux_DescInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`GNOME · Adwaita`)
};

const zh_settings_interface_linux_desc = /** @type {(inputs: Settings_Interface_Linux_DescInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`GNOME · Adwaita`)
};

/**
* | output |
* | --- |
* | "GNOME · Adwaita" |
*
* @param {Settings_Interface_Linux_DescInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_interface_linux_desc = /** @type {((inputs?: Settings_Interface_Linux_DescInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Interface_Linux_DescInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_interface_linux_desc(inputs)
	return en_settings_interface_linux_desc(inputs)
});