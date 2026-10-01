/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_Aria_Lock_ReasonInputs */

const en_worktree_aria_lock_reason = /** @type {(inputs: Worktree_Aria_Lock_ReasonInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`worktree lock reason`)
};

const zh_worktree_aria_lock_reason = /** @type {(inputs: Worktree_Aria_Lock_ReasonInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`工作树加锁原因`)
};

/**
* | output |
* | --- |
* | "worktree lock reason" |
*
* @param {Worktree_Aria_Lock_ReasonInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_aria_lock_reason = /** @type {((inputs?: Worktree_Aria_Lock_ReasonInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_Aria_Lock_ReasonInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_aria_lock_reason(inputs)
	return en_worktree_aria_lock_reason(inputs)
});