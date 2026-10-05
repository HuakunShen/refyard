/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Terminal_New_HintInputs */

const en_terminal_new_hint = /** @type {(inputs: Terminal_New_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Press + to open a terminal in this repository.`)
};

const zh_terminal_new_hint = /** @type {(inputs: Terminal_New_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`按 + 在此仓库打开终端。`)
};

/**
* | output |
* | --- |
* | "Press + to open a terminal in this repository." |
*
* @param {Terminal_New_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const terminal_new_hint = /** @type {((inputs?: Terminal_New_HintInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Terminal_New_HintInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_terminal_new_hint(inputs)
	return en_terminal_new_hint(inputs)
});