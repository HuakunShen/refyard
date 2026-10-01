/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_Drop_NoteInputs */

const en_dialog_drop_note = /** @type {(inputs: Dialog_Drop_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Removes this commit from the checked-out branch and replays the commits after it onto its parent — a history rewrite. A conflict stops it for you to resolve, like a merge. Merge commits and the branch's first commit are refused.`)
};

const zh_dialog_drop_note = /** @type {(inputs: Dialog_Drop_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`从当前检出的分支移除此提交，并将后续提交重新应用到其父提交上，这会改写历史。遇到冲突会暂停，等待你解决。不支持丢弃合并提交或分支的首个提交。`)
};

/**
* | output |
* | --- |
* | "Removes this commit from the checked-out branch and replays the commits after it onto its parent — a history rewrite. A conflict stops it for you to resolve,..." |
*
* @param {Dialog_Drop_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_drop_note = /** @type {((inputs?: Dialog_Drop_NoteInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Drop_NoteInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_drop_note(inputs)
	return en_dialog_drop_note(inputs)
});