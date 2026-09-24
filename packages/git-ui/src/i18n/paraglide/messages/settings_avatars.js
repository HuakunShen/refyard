/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_AvatarsInputs */

const en_settings_avatars = /** @type {(inputs: Settings_AvatarsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Avatars`)
};

const zh_settings_avatars = /** @type {(inputs: Settings_AvatarsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`头像`)
};

/**
* | output |
* | --- |
* | "Avatars" |
*
* @param {Settings_AvatarsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_avatars = /** @type {((inputs?: Settings_AvatarsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_AvatarsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_avatars(inputs)
	return en_settings_avatars(inputs)
});