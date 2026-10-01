/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Launcher_Path_To_BrowseInputs */

const en_launcher_path_to_browse = /** @type {(inputs: Launcher_Path_To_BrowseInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Path to browse`)
};

const zh_launcher_path_to_browse = /** @type {(inputs: Launcher_Path_To_BrowseInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`要浏览的路径`)
};

/**
* | output |
* | --- |
* | "Path to browse" |
*
* @param {Launcher_Path_To_BrowseInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_path_to_browse = /** @type {((inputs?: Launcher_Path_To_BrowseInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Launcher_Path_To_BrowseInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_launcher_path_to_browse(inputs)
	return en_launcher_path_to_browse(inputs)
});