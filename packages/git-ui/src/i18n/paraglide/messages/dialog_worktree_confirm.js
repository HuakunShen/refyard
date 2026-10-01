/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_Worktree_ConfirmInputs */

const en_dialog_worktree_confirm = /** @type {(inputs: Dialog_Worktree_ConfirmInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Create worktree`)
};

const zh_dialog_worktree_confirm = /** @type {(inputs: Dialog_Worktree_ConfirmInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`创建工作树`)
};

/**
* | output |
* | --- |
* | "Create worktree" |
*
* @param {Dialog_Worktree_ConfirmInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_worktree_confirm = /** @type {((inputs?: Dialog_Worktree_ConfirmInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Worktree_ConfirmInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_worktree_confirm(inputs)
	return en_dialog_worktree_confirm(inputs)
});