/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Interface_HintInputs */

const en_settings_interface_hint = /** @type {(inputs: Settings_Interface_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Automatic follows your platform; any style works on any device.`)
};

const zh_settings_interface_hint = /** @type {(inputs: Settings_Interface_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`自动跟随当前平台；也可在任何设备上选择任意风格。`)
};

/**
* | output |
* | --- |
* | "Automatic follows your platform; any style works on any device." |
*
* @param {Settings_Interface_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_interface_hint = /** @type {((inputs?: Settings_Interface_HintInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Interface_HintInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_interface_hint(inputs)
	return en_settings_interface_hint(inputs)
});