/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_Create_Tag_NoteInputs */

const en_dialog_create_tag_note = /** @type {(inputs: Dialog_Create_Tag_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Create a tag that points at this exact commit.`)
};

const zh_dialog_create_tag_note = /** @type {(inputs: Dialog_Create_Tag_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`创建指向此提交的标签。`)
};

/**
* | output |
* | --- |
* | "Create a tag that points at this exact commit." |
*
* @param {Dialog_Create_Tag_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_create_tag_note = /** @type {((inputs?: Dialog_Create_Tag_NoteInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Create_Tag_NoteInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_create_tag_note(inputs)
	return en_dialog_create_tag_note(inputs)
});