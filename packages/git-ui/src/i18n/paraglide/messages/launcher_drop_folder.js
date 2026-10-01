/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Launcher_Drop_FolderInputs */

const en_launcher_drop_folder = /** @type {(inputs: Launcher_Drop_FolderInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Drop the folder to open it as a repository`)
};

const zh_launcher_drop_folder = /** @type {(inputs: Launcher_Drop_FolderInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`把文件夹拖到这里打开`)
};

/**
* | output |
* | --- |
* | "Drop the folder to open it as a repository" |
*
* @param {Launcher_Drop_FolderInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_drop_folder = /** @type {((inputs?: Launcher_Drop_FolderInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Launcher_Drop_FolderInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_launcher_drop_folder(inputs)
	return en_launcher_drop_folder(inputs)
});