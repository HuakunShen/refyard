/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Command_Line_InstallInputs */

const en_settings_command_line_install = /** @type {(inputs: Settings_Command_Line_InstallInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Install \`refyard\` command`)
};

const zh_settings_command_line_install = /** @type {(inputs: Settings_Command_Line_InstallInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`安装 \`refyard\` 命令`)
};

/**
* | output |
* | --- |
* | "Install `refyard` command" |
*
* @param {Settings_Command_Line_InstallInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_command_line_install = /** @type {((inputs?: Settings_Command_Line_InstallInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Command_Line_InstallInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_command_line_install(inputs)
	return en_settings_command_line_install(inputs)
});