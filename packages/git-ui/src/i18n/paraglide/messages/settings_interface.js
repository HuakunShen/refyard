/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_InterfaceInputs */

const en_settings_interface = /** @type {(inputs: Settings_InterfaceInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Interface style`)
};

const zh_settings_interface = /** @type {(inputs: Settings_InterfaceInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`界面风格`)
};

/**
* | output |
* | --- |
* | "Interface style" |
*
* @param {Settings_InterfaceInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_interface = /** @type {((inputs?: Settings_InterfaceInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_InterfaceInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_interface(inputs)
	return en_settings_interface(inputs)
});