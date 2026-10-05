/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Terminal_Exit_UnknownInputs */

const en_terminal_exit_unknown = /** @type {(inputs: Terminal_Exit_UnknownInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Exited`)
};

const zh_terminal_exit_unknown = /** @type {(inputs: Terminal_Exit_UnknownInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`已退出`)
};

/**
* | output |
* | --- |
* | "Exited" |
*
* @param {Terminal_Exit_UnknownInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const terminal_exit_unknown = /** @type {((inputs?: Terminal_Exit_UnknownInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Terminal_Exit_UnknownInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_terminal_exit_unknown(inputs)
	return en_terminal_exit_unknown(inputs)
});