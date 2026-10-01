/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_Aria_CommitInputs */

const en_worktree_aria_commit = /** @type {(inputs: Worktree_Aria_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`worktree commit`)
};

const zh_worktree_aria_commit = /** @type {(inputs: Worktree_Aria_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`工作树提交`)
};

/**
* | output |
* | --- |
* | "worktree commit" |
*
* @param {Worktree_Aria_CommitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_aria_commit = /** @type {((inputs?: Worktree_Aria_CommitInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_Aria_CommitInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_aria_commit(inputs)
	return en_worktree_aria_commit(inputs)
});