/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_Worktree_NoteInputs */

const en_dialog_worktree_note = /** @type {(inputs: Dialog_Worktree_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Adds a linked worktree inside the approved root, with a new branch starting at this commit. Your checked-out branch and working tree stay where they are.`)
};

const zh_dialog_worktree_note = /** @type {(inputs: Dialog_Worktree_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`在批准的根目录内添加关联工作树，新分支从此提交开始。当前检出的分支和工作区保持原状。`)
};

/**
* | output |
* | --- |
* | "Adds a linked worktree inside the approved root, with a new branch starting at this commit. Your checked-out branch and working tree stay where they are." |
*
* @param {Dialog_Worktree_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_worktree_note = /** @type {((inputs?: Dialog_Worktree_NoteInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Worktree_NoteInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_worktree_note(inputs)
	return en_dialog_worktree_note(inputs)
});