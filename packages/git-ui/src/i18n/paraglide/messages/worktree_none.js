/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_NoneInputs */

const en_worktree_none = /** @type {(inputs: Worktree_NoneInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No worktrees loaded.`)
};

const zh_worktree_none = /** @type {(inputs: Worktree_NoneInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`尚未加载任何工作树。`)
};

/**
* | output |
* | --- |
* | "No worktrees loaded." |
*
* @param {Worktree_NoneInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_none = /** @type {((inputs?: Worktree_NoneInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_NoneInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_none(inputs)
	return en_worktree_none(inputs)
});