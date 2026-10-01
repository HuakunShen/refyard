/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Launcher_Choose_FolderInputs */

const en_launcher_choose_folder = /** @type {(inputs: Launcher_Choose_FolderInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Choose a repository folder`)
};

const zh_launcher_choose_folder = /** @type {(inputs: Launcher_Choose_FolderInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`选择仓库文件夹`)
};

/**
* | output |
* | --- |
* | "Choose a repository folder" |
*
* @param {Launcher_Choose_FolderInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_choose_folder = /** @type {((inputs?: Launcher_Choose_FolderInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Launcher_Choose_FolderInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_launcher_choose_folder(inputs)
	return en_launcher_choose_folder(inputs)
});