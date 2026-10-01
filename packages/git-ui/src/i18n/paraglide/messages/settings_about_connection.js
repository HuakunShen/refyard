/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_About_ConnectionInputs */

const en_settings_about_connection = /** @type {(inputs: Settings_About_ConnectionInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`About & connection`)
};

const zh_settings_about_connection = /** @type {(inputs: Settings_About_ConnectionInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`关于与连接`)
};

/**
* | output |
* | --- |
* | "About & connection" |
*
* @param {Settings_About_ConnectionInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_about_connection = /** @type {((inputs?: Settings_About_ConnectionInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_About_ConnectionInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_about_connection(inputs)
	return en_settings_about_connection(inputs)
});