/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_Lock_ReasonInputs */

const en_worktree_lock_reason = /** @type {(inputs: Worktree_Lock_ReasonInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`lock reason (optional)`)
};

const zh_worktree_lock_reason = /** @type {(inputs: Worktree_Lock_ReasonInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`锁定原因(可选)`)
};

/**
* | output |
* | --- |
* | "lock reason (optional)" |
*
* @param {Worktree_Lock_ReasonInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_lock_reason = /** @type {((inputs?: Worktree_Lock_ReasonInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_Lock_ReasonInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_lock_reason(inputs)
	return en_worktree_lock_reason(inputs)
});