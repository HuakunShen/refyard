/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Terminal_UnavailableInputs */

const en_terminal_unavailable = /** @type {(inputs: Terminal_UnavailableInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`This host offers no terminal.`)
};

const zh_terminal_unavailable = /** @type {(inputs: Terminal_UnavailableInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`当前主机不提供终端。`)
};

/**
* | output |
* | --- |
* | "This host offers no terminal." |
*
* @param {Terminal_UnavailableInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const terminal_unavailable = /** @type {((inputs?: Terminal_UnavailableInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Terminal_UnavailableInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_terminal_unavailable(inputs)
	return en_terminal_unavailable(inputs)
});