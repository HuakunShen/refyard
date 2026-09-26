/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_LockInputs */

const en_worktree_lock = /** @type {(inputs: Worktree_LockInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Lock`)
};

const zh_worktree_lock = /** @type {(inputs: Worktree_LockInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`锁定`)
};

/**
* | output |
* | --- |
* | "Lock" |
*
* @param {Worktree_LockInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_lock = /** @type {((inputs?: Worktree_LockInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_LockInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_lock(inputs)
	return en_worktree_lock(inputs)
});