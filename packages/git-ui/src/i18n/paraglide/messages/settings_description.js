/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_DescriptionInputs */

const en_settings_description = /** @type {(inputs: Settings_DescriptionInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Appearance and behaviour of this workbench.`)
};

const zh_settings_description = /** @type {(inputs: Settings_DescriptionInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`这个工作台的外观与行为。`)
};

/**
* | output |
* | --- |
* | "Appearance and behaviour of this workbench." |
*
* @param {Settings_DescriptionInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_description = /** @type {((inputs?: Settings_DescriptionInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_DescriptionInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_description(inputs)
	return en_settings_description(inputs)
});