/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Command_LineInputs */

const en_settings_command_line = /** @type {(inputs: Settings_Command_LineInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Command line`)
};

const zh_settings_command_line = /** @type {(inputs: Settings_Command_LineInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`命令行`)
};

/**
* | output |
* | --- |
* | "Command line" |
*
* @param {Settings_Command_LineInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_command_line = /** @type {((inputs?: Settings_Command_LineInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Command_LineInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_command_line(inputs)
	return en_settings_command_line(inputs)
});