/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Interface_LinuxInputs */

const en_settings_interface_linux = /** @type {(inputs: Settings_Interface_LinuxInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Linux`)
};

const zh_settings_interface_linux = /** @type {(inputs: Settings_Interface_LinuxInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Linux`)
};

/**
* | output |
* | --- |
* | "Linux" |
*
* @param {Settings_Interface_LinuxInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_interface_linux = /** @type {((inputs?: Settings_Interface_LinuxInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Interface_LinuxInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_interface_linux(inputs)
	return en_settings_interface_linux(inputs)
});