/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Terminal_Close_PanelInputs */

const en_terminal_close_panel = /** @type {(inputs: Terminal_Close_PanelInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Close terminal panel`)
};

const zh_terminal_close_panel = /** @type {(inputs: Terminal_Close_PanelInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`关闭终端面板`)
};

/**
* | output |
* | --- |
* | "Close terminal panel" |
*
* @param {Terminal_Close_PanelInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const terminal_close_panel = /** @type {((inputs?: Terminal_Close_PanelInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Terminal_Close_PanelInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_terminal_close_panel(inputs)
	return en_terminal_close_panel(inputs)
});