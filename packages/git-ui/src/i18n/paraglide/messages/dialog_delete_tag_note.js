/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_Delete_Tag_NoteInputs */

const en_dialog_delete_tag_note = /** @type {(inputs: Dialog_Delete_Tag_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`The tag is removed from this repository. Pushed copies stay on the remote until pushed as a deletion.`)
};

const zh_dialog_delete_tag_note = /** @type {(inputs: Dialog_Delete_Tag_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`标签将从此仓库移除。远端副本会保留，直到另行推送删除操作。`)
};

/**
* | output |
* | --- |
* | "The tag is removed from this repository. Pushed copies stay on the remote until pushed as a deletion." |
*
* @param {Dialog_Delete_Tag_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_delete_tag_note = /** @type {((inputs?: Dialog_Delete_Tag_NoteInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Delete_Tag_NoteInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_delete_tag_note(inputs)
	return en_dialog_delete_tag_note(inputs)
});