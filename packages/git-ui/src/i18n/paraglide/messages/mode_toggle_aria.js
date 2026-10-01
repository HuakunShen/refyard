/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Mode_Toggle_AriaInputs */

const en_mode_toggle_aria = /** @type {(inputs: Mode_Toggle_AriaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Toggle theme`)
};

const zh_mode_toggle_aria = /** @type {(inputs: Mode_Toggle_AriaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`切换主题`)
};

/**
* | output |
* | --- |
* | "Toggle theme" |
*
* @param {Mode_Toggle_AriaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const mode_toggle_aria = /** @type {((inputs?: Mode_Toggle_AriaInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Mode_Toggle_AriaInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_mode_toggle_aria(inputs)
	return en_mode_toggle_aria(inputs)
});