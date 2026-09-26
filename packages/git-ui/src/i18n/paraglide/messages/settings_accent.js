/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_AccentInputs */

const en_settings_accent = /** @type {(inputs: Settings_AccentInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Accent`)
};

const zh_settings_accent = /** @type {(inputs: Settings_AccentInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`主题色`)
};

/**
* | output |
* | --- |
* | "Accent" |
*
* @param {Settings_AccentInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_accent = /** @type {((inputs?: Settings_AccentInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_AccentInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_accent(inputs)
	return en_settings_accent(inputs)
});