/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Launcher_Use_FolderInputs */

const en_launcher_use_folder = /** @type {(inputs: Launcher_Use_FolderInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Use this folder`)
};

const zh_launcher_use_folder = /** @type {(inputs: Launcher_Use_FolderInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`使用此文件夹`)
};

/**
* | output |
* | --- |
* | "Use this folder" |
*
* @param {Launcher_Use_FolderInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_use_folder = /** @type {((inputs?: Launcher_Use_FolderInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Launcher_Use_FolderInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_launcher_use_folder(inputs)
	return en_launcher_use_folder(inputs)
});