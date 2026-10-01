/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Appearance_Toggle_PhotosInputs */

const en_appearance_toggle_photos = /** @type {(inputs: Appearance_Toggle_PhotosInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Toggle author photos`)
};

const zh_appearance_toggle_photos = /** @type {(inputs: Appearance_Toggle_PhotosInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`切换作者头像`)
};

/**
* | output |
* | --- |
* | "Toggle author photos" |
*
* @param {Appearance_Toggle_PhotosInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_toggle_photos = /** @type {((inputs?: Appearance_Toggle_PhotosInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Appearance_Toggle_PhotosInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_appearance_toggle_photos(inputs)
	return en_appearance_toggle_photos(inputs)
});