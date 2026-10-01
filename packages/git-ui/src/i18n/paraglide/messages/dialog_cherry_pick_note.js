/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_Cherry_Pick_NoteInputs */

const en_dialog_cherry_pick_note = /** @type {(inputs: Dialog_Cherry_Pick_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Applies this commit's change onto your checked-out branch as a new commit, keeping the original message and author. A conflict stops it for you to resolve, like a merge; a merge commit itself is refused.`)
};

const zh_dialog_cherry_pick_note = /** @type {(inputs: Dialog_Cherry_Pick_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`将此提交的改动作为新提交应用到当前检出的分支，保留原始提交说明和作者。遇到冲突会暂停，等待你解决；不支持摘取合并提交。`)
};

/**
* | output |
* | --- |
* | "Applies this commit's change onto your checked-out branch as a new commit, keeping the original message and author. A conflict stops it for you to resolve, l..." |
*
* @param {Dialog_Cherry_Pick_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_cherry_pick_note = /** @type {((inputs?: Dialog_Cherry_Pick_NoteInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Cherry_Pick_NoteInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_cherry_pick_note(inputs)
	return en_dialog_cherry_pick_note(inputs)
});