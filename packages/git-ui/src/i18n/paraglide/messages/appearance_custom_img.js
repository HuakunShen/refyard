/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Appearance_Custom_ImgInputs */

const en_appearance_custom_img = /** @type {(inputs: Appearance_Custom_ImgInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Custom image URL (https://...)`)
};

const zh_appearance_custom_img = /** @type {(inputs: Appearance_Custom_ImgInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`自定义图片地址(https://...)`)
};

/**
* | output |
* | --- |
* | "Custom image URL (https://...)" |
*
* @param {Appearance_Custom_ImgInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_custom_img = /** @type {((inputs?: Appearance_Custom_ImgInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Appearance_Custom_ImgInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_appearance_custom_img(inputs)
	return en_appearance_custom_img(inputs)
});