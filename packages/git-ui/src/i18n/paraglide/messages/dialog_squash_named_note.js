/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ parent: NonNullable<unknown>, subject: NonNullable<unknown> }} Dialog_Squash_Named_NoteInputs */

const en_dialog_squash_named_note = /** @type {(inputs: Dialog_Squash_Named_NoteInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`The two commits become one, combining "${i?.parent}" and "${i?.subject}". No content is lost.`)
};

const zh_dialog_squash_named_note = /** @type {(inputs: Dialog_Squash_Named_NoteInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`两个提交合为一个，合并「${i?.parent}」和「${i?.subject}」的改动，不丢失内容。`)
};

/**
* | output |
* | --- |
* | "The two commits become one, combining \"{parent}\" and \"{subject}\". No content is lost." |
*
* @param {Dialog_Squash_Named_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_squash_named_note = /** @type {((inputs: Dialog_Squash_Named_NoteInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Squash_Named_NoteInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_squash_named_note(inputs)
	return en_dialog_squash_named_note(inputs)
});