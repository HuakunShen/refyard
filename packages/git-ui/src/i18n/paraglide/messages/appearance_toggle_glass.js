/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Appearance_Toggle_GlassInputs */

const en_appearance_toggle_glass = /** @type {(inputs: Appearance_Toggle_GlassInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Toggle frosted glass`)
};

const zh_appearance_toggle_glass = /** @type {(inputs: Appearance_Toggle_GlassInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`切换毛玻璃`)
};

/**
* | output |
* | --- |
* | "Toggle frosted glass" |
*
* @param {Appearance_Toggle_GlassInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_toggle_glass = /** @type {((inputs?: Appearance_Toggle_GlassInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Appearance_Toggle_GlassInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_appearance_toggle_glass(inputs)
	return en_appearance_toggle_glass(inputs)
});