/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Launcher_Picker_ErrorInputs */

const en_launcher_picker_error = /** @type {(inputs: Launcher_Picker_ErrorInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Could not open the folder picker`)
};

const zh_launcher_picker_error = /** @type {(inputs: Launcher_Picker_ErrorInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`无法打开文件夹选择器`)
};

/**
* | output |
* | --- |
* | "Could not open the folder picker" |
*
* @param {Launcher_Picker_ErrorInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_picker_error = /** @type {((inputs?: Launcher_Picker_ErrorInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Launcher_Picker_ErrorInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_launcher_picker_error(inputs)
	return en_launcher_picker_error(inputs)
});