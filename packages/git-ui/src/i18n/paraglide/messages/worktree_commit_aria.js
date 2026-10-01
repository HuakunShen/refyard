/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_Commit_AriaInputs */

const en_worktree_commit_aria = /** @type {(inputs: Worktree_Commit_AriaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`commit object name`)
};

const zh_worktree_commit_aria = /** @type {(inputs: Worktree_Commit_AriaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`提交对象名`)
};

/**
* | output |
* | --- |
* | "commit object name" |
*
* @param {Worktree_Commit_AriaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_commit_aria = /** @type {((inputs?: Worktree_Commit_AriaInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_Commit_AriaInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_commit_aria(inputs)
	return en_worktree_commit_aria(inputs)
});