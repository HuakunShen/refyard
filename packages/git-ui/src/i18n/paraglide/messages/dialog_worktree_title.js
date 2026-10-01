/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ subject: NonNullable<unknown> }} Dialog_Worktree_TitleInputs */

const en_dialog_worktree_title = /** @type {(inputs: Dialog_Worktree_TitleInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Create worktree from "${i?.subject}"?`)
};

const zh_dialog_worktree_title = /** @type {(inputs: Dialog_Worktree_TitleInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`从「${i?.subject}」创建工作树？`)
};

/**
* | output |
* | --- |
* | "Create worktree from \"{subject}\"?" |
*
* @param {Dialog_Worktree_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_worktree_title = /** @type {((inputs: Dialog_Worktree_TitleInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Worktree_TitleInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_worktree_title(inputs)
	return en_dialog_worktree_title(inputs)
});