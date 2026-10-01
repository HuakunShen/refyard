/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Filters_All_FilesInputs */

const en_filters_all_files = /** @type {(inputs: Filters_All_FilesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`All files`)
};

const zh_filters_all_files = /** @type {(inputs: Filters_All_FilesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`全部文件`)
};

/**
* | output |
* | --- |
* | "All files" |
*
* @param {Filters_All_FilesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_all_files = /** @type {((inputs?: Filters_All_FilesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filters_All_FilesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filters_all_files(inputs)
	return en_filters_all_files(inputs)
});