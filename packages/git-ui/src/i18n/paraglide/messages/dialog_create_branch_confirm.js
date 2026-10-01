/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_Create_Branch_ConfirmInputs */

const en_dialog_create_branch_confirm = /** @type {(inputs: Dialog_Create_Branch_ConfirmInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Create branch`)
};

const zh_dialog_create_branch_confirm = /** @type {(inputs: Dialog_Create_Branch_ConfirmInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`创建分支`)
};

/**
* | output |
* | --- |
* | "Create branch" |
*
* @param {Dialog_Create_Branch_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_create_branch_confirm = /** @type {((inputs?: Dialog_Create_Branch_ConfirmInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Create_Branch_ConfirmInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_create_branch_confirm(inputs)
	return en_dialog_create_branch_confirm(inputs)
});