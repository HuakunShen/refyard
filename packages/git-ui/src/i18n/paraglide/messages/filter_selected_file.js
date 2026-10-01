/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Filter_Selected_FileInputs */

const en_filter_selected_file = /** @type {(inputs: Filter_Selected_FileInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Selected file`)
};

const zh_filter_selected_file = /** @type {(inputs: Filter_Selected_FileInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`已选文件`)
};

/**
* | output |
* | --- |
* | "Selected file" |
*
* @param {Filter_Selected_FileInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filter_selected_file = /** @type {((inputs?: Filter_Selected_FileInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filter_Selected_FileInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filter_selected_file(inputs)
	return en_filter_selected_file(inputs)
});