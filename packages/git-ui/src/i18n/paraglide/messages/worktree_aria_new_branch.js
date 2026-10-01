/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_Aria_New_BranchInputs */

const en_worktree_aria_new_branch = /** @type {(inputs: Worktree_Aria_New_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`worktree new branch`)
};

const zh_worktree_aria_new_branch = /** @type {(inputs: Worktree_Aria_New_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`工作树新分支`)
};

/**
* | output |
* | --- |
* | "worktree new branch" |
*
* @param {Worktree_Aria_New_BranchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_aria_new_branch = /** @type {((inputs?: Worktree_Aria_New_BranchInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_Aria_New_BranchInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_aria_new_branch(inputs)
	return en_worktree_aria_new_branch(inputs)
});