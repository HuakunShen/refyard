/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Launcher_Read_Dir_ErrorInputs */

const en_launcher_read_dir_error = /** @type {(inputs: Launcher_Read_Dir_ErrorInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Could not read this directory`)
};

const zh_launcher_read_dir_error = /** @type {(inputs: Launcher_Read_Dir_ErrorInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`无法读取此目录`)
};

/**
* | output |
* | --- |
* | "Could not read this directory" |
*
* @param {Launcher_Read_Dir_ErrorInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_read_dir_error = /** @type {((inputs?: Launcher_Read_Dir_ErrorInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Launcher_Read_Dir_ErrorInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_launcher_read_dir_error(inputs)
	return en_launcher_read_dir_error(inputs)
});