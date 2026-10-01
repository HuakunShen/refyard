/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Dialog_Worktree_PlaceholderInputs */

const en_dialog_worktree_placeholder = /** @type {(inputs: Dialog_Worktree_PlaceholderInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`e.g. worktrees/my-branch`)
};

const zh_dialog_worktree_placeholder = /** @type {(inputs: Dialog_Worktree_PlaceholderInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`例如 worktrees/my-branch`)
};

/**
* | output |
* | --- |
* | "e.g. worktrees/my-branch" |
*
* @param {Dialog_Worktree_PlaceholderInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const dialog_worktree_placeholder = /** @type {((inputs?: Dialog_Worktree_PlaceholderInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Dialog_Worktree_PlaceholderInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_dialog_worktree_placeholder(inputs)
	return en_dialog_worktree_placeholder(inputs)
});