/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_Reset_NoteInputs */

const en_dialog_reset_note = /** @type {(inputs: Dialog_Reset_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Moves the checked-out branch to this commit. The working tree is never touched and no content is lost.`)
};

const zh_dialog_reset_note = /** @type {(inputs: Dialog_Reset_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`将当前检出的分支移动到此提交。不会修改工作区，也不会丢失文件内容。`)
};

/**
* | output |
* | --- |
* | "Moves the checked-out branch to this commit. The working tree is never touched and no content is lost." |
*
* @param {Dialog_Reset_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_reset_note = /** @type {((inputs?: Dialog_Reset_NoteInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Reset_NoteInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_reset_note(inputs)
	return en_dialog_reset_note(inputs)
});