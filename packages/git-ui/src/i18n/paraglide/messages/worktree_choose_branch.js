/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_Choose_BranchInputs */

const en_worktree_choose_branch = /** @type {(inputs: Worktree_Choose_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`choose a branch`)
};

const zh_worktree_choose_branch = /** @type {(inputs: Worktree_Choose_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`选择分支`)
};

/**
* | output |
* | --- |
* | "choose a branch" |
*
* @param {Worktree_Choose_BranchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_choose_branch = /** @type {((inputs?: Worktree_Choose_BranchInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_Choose_BranchInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_choose_branch(inputs)
	return en_worktree_choose_branch(inputs)
});