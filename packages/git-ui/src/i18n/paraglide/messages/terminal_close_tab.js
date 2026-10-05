/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Terminal_Close_TabInputs */

const en_terminal_close_tab = /** @type {(inputs: Terminal_Close_TabInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Close terminal`)
};

const zh_terminal_close_tab = /** @type {(inputs: Terminal_Close_TabInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`关闭终端`)
};

/**
* | output |
* | --- |
* | "Close terminal" |
*
* @param {Terminal_Close_TabInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const terminal_close_tab = /** @type {((inputs?: Terminal_Close_TabInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Terminal_Close_TabInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_terminal_close_tab(inputs)
	return en_terminal_close_tab(inputs)
});