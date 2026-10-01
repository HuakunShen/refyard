/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Appearance_Custom_BgInputs */

const en_appearance_custom_bg = /** @type {(inputs: Appearance_Custom_BgInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Custom background URL`)
};

const zh_appearance_custom_bg = /** @type {(inputs: Appearance_Custom_BgInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`自定义背景地址`)
};

/**
* | output |
* | --- |
* | "Custom background URL" |
*
* @param {Appearance_Custom_BgInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_custom_bg = /** @type {((inputs?: Appearance_Custom_BgInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Appearance_Custom_BgInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_appearance_custom_bg(inputs)
	return en_appearance_custom_bg(inputs)
});