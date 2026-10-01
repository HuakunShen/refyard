/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_Reset_ConfirmInputs */

const en_dialog_reset_confirm = /** @type {(inputs: Dialog_Reset_ConfirmInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Reset branch`)
};

const zh_dialog_reset_confirm = /** @type {(inputs: Dialog_Reset_ConfirmInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`重置分支`)
};

/**
* | output |
* | --- |
* | "Reset branch" |
*
* @param {Dialog_Reset_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_reset_confirm = /** @type {((inputs?: Dialog_Reset_ConfirmInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Reset_ConfirmInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_reset_confirm(inputs)
	return en_dialog_reset_confirm(inputs)
});