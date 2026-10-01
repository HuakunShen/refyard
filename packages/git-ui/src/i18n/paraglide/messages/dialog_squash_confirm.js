/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_Squash_ConfirmInputs */

const en_dialog_squash_confirm = /** @type {(inputs: Dialog_Squash_ConfirmInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Squash`)
};

const zh_dialog_squash_confirm = /** @type {(inputs: Dialog_Squash_ConfirmInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`压缩提交`)
};

/**
* | output |
* | --- |
* | "Squash" |
*
* @param {Dialog_Squash_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_squash_confirm = /** @type {((inputs?: Dialog_Squash_ConfirmInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Squash_ConfirmInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_squash_confirm(inputs)
	return en_dialog_squash_confirm(inputs)
});