/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_New_Branch_LabelInputs */

const en_worktree_new_branch_label = /** @type {(inputs: Worktree_New_Branch_LabelInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`new branch`)
};

const zh_worktree_new_branch_label = /** @type {(inputs: Worktree_New_Branch_LabelInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`新分支`)
};

/**
* | output |
* | --- |
* | "new branch" |
*
* @param {Worktree_New_Branch_LabelInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_new_branch_label = /** @type {((inputs?: Worktree_New_Branch_LabelInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_New_Branch_LabelInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_new_branch_label(inputs)
	return en_worktree_new_branch_label(inputs)
});