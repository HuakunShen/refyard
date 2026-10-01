/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ name: NonNullable<unknown> }} Dialog_Delete_Branch_ConfirmInputs */

const en_dialog_delete_branch_confirm = /** @type {(inputs: Dialog_Delete_Branch_ConfirmInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Delete ${i?.name}`)
};

const zh_dialog_delete_branch_confirm = /** @type {(inputs: Dialog_Delete_Branch_ConfirmInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`删除 ${i?.name}`)
};

/**
* | output |
* | --- |
* | "Delete {name}" |
*
* @param {Dialog_Delete_Branch_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_delete_branch_confirm = /** @type {((inputs: Dialog_Delete_Branch_ConfirmInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Delete_Branch_ConfirmInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_delete_branch_confirm(inputs)
	return en_dialog_delete_branch_confirm(inputs)
});