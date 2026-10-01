/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_Revert_NoteInputs */

const en_dialog_revert_note = /** @type {(inputs: Dialog_Revert_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Creates a new commit that undoes this one, with Git's own revert message and your hooks running. Merge commits are refused, and if the revert conflicts with your working tree it is aborted, so your branch comes out unchanged.`)
};

const zh_dialog_revert_note = /** @type {(inputs: Dialog_Revert_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`创建一个新提交来撤销此提交，使用 Git 的还原说明并运行你的钩子。不支持还原合并提交；如果与工作区冲突，将中止还原，保持分支不变。`)
};

/**
* | output |
* | --- |
* | "Creates a new commit that undoes this one, with Git's own revert message and your hooks running. Merge commits are refused, and if the revert conflicts with ..." |
*
* @param {Dialog_Revert_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_revert_note = /** @type {((inputs?: Dialog_Revert_NoteInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Revert_NoteInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_revert_note(inputs)
	return en_dialog_revert_note(inputs)
});