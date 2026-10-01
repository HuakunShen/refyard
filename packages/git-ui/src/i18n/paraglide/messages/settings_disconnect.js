/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_DisconnectInputs */

const en_settings_disconnect = /** @type {(inputs: Settings_DisconnectInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Disconnect`)
};

const zh_settings_disconnect = /** @type {(inputs: Settings_DisconnectInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`断开连接`)
};

/**
* | output |
* | --- |
* | "Disconnect" |
*
* @param {Settings_DisconnectInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_disconnect = /** @type {((inputs?: Settings_DisconnectInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_DisconnectInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_disconnect(inputs)
	return en_settings_disconnect(inputs)
});