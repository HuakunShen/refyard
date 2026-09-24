/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_Select_HintInputs */

const en_worktree_select_hint = /** @type {(inputs: Worktree_Select_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Select a worktree below. Its changed files and commit message are on the right.`)
};

const zh_worktree_select_hint = /** @type {(inputs: Worktree_Select_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`在下方选择一个工作树。它的变更文件和提交信息在右侧。`)
};

/**
* | output |
* | --- |
* | "Select a worktree below. Its changed files and commit message are on the right." |
*
* @param {Worktree_Select_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_select_hint = /** @type {((inputs?: Worktree_Select_HintInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_Select_HintInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_select_hint(inputs)
	return en_worktree_select_hint(inputs)
});