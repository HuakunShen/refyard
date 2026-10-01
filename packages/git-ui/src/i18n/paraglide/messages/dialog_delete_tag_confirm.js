/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ name: NonNullable<unknown> }} Dialog_Delete_Tag_ConfirmInputs */

const en_dialog_delete_tag_confirm = /** @type {(inputs: Dialog_Delete_Tag_ConfirmInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Delete tag ${i?.name}`)
};

const zh_dialog_delete_tag_confirm = /** @type {(inputs: Dialog_Delete_Tag_ConfirmInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`删除标签 ${i?.name}`)
};

/**
* | output |
* | --- |
* | "Delete tag {name}" |
*
* @param {Dialog_Delete_Tag_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_delete_tag_confirm = /** @type {((inputs: Dialog_Delete_Tag_ConfirmInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Delete_Tag_ConfirmInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_delete_tag_confirm(inputs)
	return en_dialog_delete_tag_confirm(inputs)
});