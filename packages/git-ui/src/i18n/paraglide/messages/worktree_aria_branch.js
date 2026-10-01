/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_Aria_BranchInputs */

const en_worktree_aria_branch = /** @type {(inputs: Worktree_Aria_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`worktree branch`)
};

const zh_worktree_aria_branch = /** @type {(inputs: Worktree_Aria_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`工作树分支`)
};

/**
* | output |
* | --- |
* | "worktree branch" |
*
* @param {Worktree_Aria_BranchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_aria_branch = /** @type {((inputs?: Worktree_Aria_BranchInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_Aria_BranchInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_aria_branch(inputs)
	return en_worktree_aria_branch(inputs)
});