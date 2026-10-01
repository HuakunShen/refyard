/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_Reset_Soft_NoteInputs */

const en_dialog_reset_soft_note = /** @type {(inputs: Dialog_Reset_Soft_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Moves the branch and leaves the index exactly as it is, so the same changes stay staged on top of the new head.`)
};

const zh_dialog_reset_soft_note = /** @type {(inputs: Dialog_Reset_Soft_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`移动分支并保持暂存区原样，原有改动仍暂存在新的 HEAD 之上。`)
};

/**
* | output |
* | --- |
* | "Moves the branch and leaves the index exactly as it is, so the same changes stay staged on top of the new head." |
*
* @param {Dialog_Reset_Soft_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_reset_soft_note = /** @type {((inputs?: Dialog_Reset_Soft_NoteInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Reset_Soft_NoteInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_reset_soft_note(inputs)
	return en_dialog_reset_soft_note(inputs)
});