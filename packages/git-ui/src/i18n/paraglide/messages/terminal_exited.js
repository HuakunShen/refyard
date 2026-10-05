/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ code: NonNullable<unknown> }} Terminal_ExitedInputs */

const en_terminal_exited = /** @type {(inputs: Terminal_ExitedInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Exited (${i?.code})`)
};

const zh_terminal_exited = /** @type {(inputs: Terminal_ExitedInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`已退出（${i?.code}）`)
};

/**
* | output |
* | --- |
* | "Exited ({code})" |
*
* @param {Terminal_ExitedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const terminal_exited = /** @type {((inputs: Terminal_ExitedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Terminal_ExitedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_terminal_exited(inputs)
	return en_terminal_exited(inputs)
});