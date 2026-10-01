/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Appearance_BackgroundInputs */

const en_appearance_background = /** @type {(inputs: Appearance_BackgroundInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Workbench Background`)
};

const zh_appearance_background = /** @type {(inputs: Appearance_BackgroundInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`工作台背景`)
};

/**
* | output |
* | --- |
* | "Workbench Background" |
*
* @param {Appearance_BackgroundInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const appearance_background = /** @type {((inputs?: Appearance_BackgroundInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Appearance_BackgroundInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_appearance_background(inputs)
	return en_appearance_background(inputs)
});