/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_TitleInputs */

const en_settings_title = /** @type {(inputs: Settings_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Settings`)
};

const zh_settings_title = /** @type {(inputs: Settings_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`设置`)
};

/**
* | output |
* | --- |
* | "Settings" |
*
* @param {Settings_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_title = /** @type {((inputs?: Settings_TitleInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_TitleInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_title(inputs)
	return en_settings_title(inputs)
});