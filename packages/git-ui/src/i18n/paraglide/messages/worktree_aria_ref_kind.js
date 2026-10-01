/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_Aria_Ref_KindInputs */

const en_worktree_aria_ref_kind = /** @type {(inputs: Worktree_Aria_Ref_KindInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`worktree reference kind`)
};

const zh_worktree_aria_ref_kind = /** @type {(inputs: Worktree_Aria_Ref_KindInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`工作树引用类型`)
};

/**
* | output |
* | --- |
* | "worktree reference kind" |
*
* @param {Worktree_Aria_Ref_KindInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_aria_ref_kind = /** @type {((inputs?: Worktree_Aria_Ref_KindInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_Aria_Ref_KindInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_aria_ref_kind(inputs)
	return en_worktree_aria_ref_kind(inputs)
});