/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_Create_Branch_NoteInputs */

const en_dialog_create_branch_note = /** @type {(inputs: Dialog_Create_Branch_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Create a branch that points at this exact commit without switching HEAD.`)
};

const zh_dialog_create_branch_note = /** @type {(inputs: Dialog_Create_Branch_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`创建指向此提交的分支，不切换 HEAD。`)
};

/**
* | output |
* | --- |
* | "Create a branch that points at this exact commit without switching HEAD." |
*
* @param {Dialog_Create_Branch_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_create_branch_note = /** @type {((inputs?: Dialog_Create_Branch_NoteInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Create_Branch_NoteInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_create_branch_note(inputs)
	return en_dialog_create_branch_note(inputs)
});