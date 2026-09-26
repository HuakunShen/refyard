/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_CloseInputs */

const en_settings_close = /** @type {(inputs: Settings_CloseInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Close`)
};

const zh_settings_close = /** @type {(inputs: Settings_CloseInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`关闭`)
};

/**
* | output |
* | --- |
* | "Close" |
*
* @param {Settings_CloseInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_close = /** @type {((inputs?: Settings_CloseInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_CloseInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_close(inputs)
	return en_settings_close(inputs)
});