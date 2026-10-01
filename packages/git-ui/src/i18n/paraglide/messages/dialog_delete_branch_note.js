/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_Delete_Branch_NoteInputs */

const en_dialog_delete_branch_note = /** @type {(inputs: Dialog_Delete_Branch_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Only fully merged branches can be deleted; unmerged work is refused by Git.`)
};

const zh_dialog_delete_branch_note = /** @type {(inputs: Dialog_Delete_Branch_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`只能删除已完全合并的分支；Git 会拒绝删除包含未合并的工作的分支。`)
};

/**
* | output |
* | --- |
* | "Only fully merged branches can be deleted; unmerged work is refused by Git." |
*
* @param {Dialog_Delete_Branch_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_delete_branch_note = /** @type {((inputs?: Dialog_Delete_Branch_NoteInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Delete_Branch_NoteInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_delete_branch_note(inputs)
	return en_dialog_delete_branch_note(inputs)
});