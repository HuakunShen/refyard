/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_New_Branch_NameInputs */

const en_worktree_new_branch_name = /** @type {(inputs: Worktree_New_Branch_NameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`new branch name`)
};

const zh_worktree_new_branch_name = /** @type {(inputs: Worktree_New_Branch_NameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`新分支名`)
};

/**
* | output |
* | --- |
* | "new branch name" |
*
* @param {Worktree_New_Branch_NameInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_new_branch_name = /** @type {((inputs?: Worktree_New_Branch_NameInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_New_Branch_NameInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_new_branch_name(inputs)
	return en_worktree_new_branch_name(inputs)
});