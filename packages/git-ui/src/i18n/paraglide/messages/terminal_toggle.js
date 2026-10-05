/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Terminal_ToggleInputs */

const en_terminal_toggle = /** @type {(inputs: Terminal_ToggleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Terminal`)
};

const zh_terminal_toggle = /** @type {(inputs: Terminal_ToggleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`终端`)
};

/**
* | output |
* | --- |
* | "Terminal" |
*
* @param {Terminal_ToggleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const terminal_toggle = /** @type {((inputs?: Terminal_ToggleInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Terminal_ToggleInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_terminal_toggle(inputs)
	return en_terminal_toggle(inputs)
});