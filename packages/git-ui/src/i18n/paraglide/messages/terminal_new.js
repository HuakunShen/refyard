/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Terminal_NewInputs */

const en_terminal_new = /** @type {(inputs: Terminal_NewInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`New terminal`)
};

const zh_terminal_new = /** @type {(inputs: Terminal_NewInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`新建终端`)
};

/**
* | output |
* | --- |
* | "New terminal" |
*
* @param {Terminal_NewInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const terminal_new = /** @type {((inputs?: Terminal_NewInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Terminal_NewInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_terminal_new(inputs)
	return en_terminal_new(inputs)
});