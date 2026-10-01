/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} All_SelectedInputs */

const en_all_selected = /** @type {(inputs: All_SelectedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`All selected`)
};

const zh_all_selected = /** @type {(inputs: All_SelectedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`已全选`)
};

/**
* | output |
* | --- |
* | "All selected" |
*
* @param {All_SelectedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const all_selected = /** @type {((inputs?: All_SelectedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<All_SelectedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_all_selected(inputs)
	return en_all_selected(inputs)
});