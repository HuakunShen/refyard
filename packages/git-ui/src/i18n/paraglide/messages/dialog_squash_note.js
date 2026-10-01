/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_Squash_NoteInputs */

const en_dialog_squash_note = /** @type {(inputs: Dialog_Squash_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`The two commits become one, combining both changes. No content is lost.`)
};

const zh_dialog_squash_note = /** @type {(inputs: Dialog_Squash_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`两个提交合为一个，合并两者的改动，不丢失内容。`)
};

/**
* | output |
* | --- |
* | "The two commits become one, combining both changes. No content is lost." |
*
* @param {Dialog_Squash_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_squash_note = /** @type {((inputs?: Dialog_Squash_NoteInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Squash_NoteInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_squash_note(inputs)
	return en_dialog_squash_note(inputs)
});