/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_DropInputs */

const en_dialog_drop = /** @type {(inputs: Dialog_DropInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Drop`)
};

const zh_dialog_drop = /** @type {(inputs: Dialog_DropInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`丢弃`)
};

/**
* | output |
* | --- |
* | "Drop" |
*
* @param {Dialog_DropInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_drop = /** @type {((inputs?: Dialog_DropInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_DropInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_drop(inputs)
	return en_dialog_drop(inputs)
});