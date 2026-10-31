/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Command_Line_DetailInputs */

const en_settings_command_line_detail = /** @type {(inputs: Settings_Command_Line_DetailInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Install a \`refyard\` command so \`refyard .\` in a terminal opens that directory here.`)
};

const zh_settings_command_line_detail = /** @type {(inputs: Settings_Command_Line_DetailInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`安装 \`refyard\` 命令后，在终端执行 \`refyard .\` 即可在这里打开该目录。`)
};

/**
* | output |
* | --- |
* | "Install a `refyard` command so `refyard .` in a terminal opens that directory here." |
*
* @param {Settings_Command_Line_DetailInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_command_line_detail = /** @type {((inputs?: Settings_Command_Line_DetailInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Command_Line_DetailInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_command_line_detail(inputs)
	return en_settings_command_line_detail(inputs)
});