/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_Reset_Mixed_NoteInputs */

const en_dialog_reset_mixed_note = /** @type {(inputs: Dialog_Reset_Mixed_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Moves the branch and resets the index to the commit. Staged work becomes unstaged; every file keeps its content.`)
};

const zh_dialog_reset_mixed_note = /** @type {(inputs: Dialog_Reset_Mixed_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`移动分支并将暂存区重置为此提交。已暂存的改动变为未暂存；每个文件的内容都保留。`)
};

/**
* | output |
* | --- |
* | "Moves the branch and resets the index to the commit. Staged work becomes unstaged; every file keeps its content." |
*
* @param {Dialog_Reset_Mixed_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_reset_mixed_note = /** @type {((inputs?: Dialog_Reset_Mixed_NoteInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Reset_Mixed_NoteInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_reset_mixed_note(inputs)
	return en_dialog_reset_mixed_note(inputs)
});