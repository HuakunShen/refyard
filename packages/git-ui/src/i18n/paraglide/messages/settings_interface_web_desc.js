/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Interface_Web_DescInputs */

const en_settings_interface_web_desc = /** @type {(inputs: Settings_Interface_Web_DescInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Clean and familiar`)
};

const zh_settings_interface_web_desc = /** @type {(inputs: Settings_Interface_Web_DescInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`干净而熟悉`)
};

/**
* | output |
* | --- |
* | "Clean and familiar" |
*
* @param {Settings_Interface_Web_DescInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_interface_web_desc = /** @type {((inputs?: Settings_Interface_Web_DescInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Interface_Web_DescInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_interface_web_desc(inputs)
	return en_settings_interface_web_desc(inputs)
});