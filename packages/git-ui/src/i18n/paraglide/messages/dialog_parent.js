/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_ParentInputs */

const en_dialog_parent = /** @type {(inputs: Dialog_ParentInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`the parent`)
};

const zh_dialog_parent = /** @type {(inputs: Dialog_ParentInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`父提交说明`)
};

/**
* | output |
* | --- |
* | "the parent" |
*
* @param {Dialog_ParentInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_parent = /** @type {((inputs?: Dialog_ParentInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_ParentInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_parent(inputs)
	return en_dialog_parent(inputs)
});