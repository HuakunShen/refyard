/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_UnlockInputs */

const en_worktree_unlock = /** @type {(inputs: Worktree_UnlockInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Unlock`)
};

const zh_worktree_unlock = /** @type {(inputs: Worktree_UnlockInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`解锁`)
};

/**
* | output |
* | --- |
* | "Unlock" |
*
* @param {Worktree_UnlockInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_unlock = /** @type {((inputs?: Worktree_UnlockInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_UnlockInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_unlock(inputs)
	return en_worktree_unlock(inputs)
});