/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_Existing_BranchInputs */

const en_worktree_existing_branch = /** @type {(inputs: Worktree_Existing_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`existing branch`)
};

const zh_worktree_existing_branch = /** @type {(inputs: Worktree_Existing_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`已有分支`)
};

/**
* | output |
* | --- |
* | "existing branch" |
*
* @param {Worktree_Existing_BranchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_existing_branch = /** @type {((inputs?: Worktree_Existing_BranchInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_Existing_BranchInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_existing_branch(inputs)
	return en_worktree_existing_branch(inputs)
});