/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_Branch_AriaInputs */

const en_worktree_branch_aria = /** @type {(inputs: Worktree_Branch_AriaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`branch this worktree works on`)
};

const zh_worktree_branch_aria = /** @type {(inputs: Worktree_Branch_AriaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`此工作树所在的分支`)
};

/**
* | output |
* | --- |
* | "branch this worktree works on" |
*
* @param {Worktree_Branch_AriaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_branch_aria = /** @type {((inputs?: Worktree_Branch_AriaInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_Branch_AriaInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_branch_aria(inputs)
	return en_worktree_branch_aria(inputs)
});