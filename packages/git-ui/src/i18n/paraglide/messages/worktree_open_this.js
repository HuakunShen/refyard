/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_Open_ThisInputs */

const en_worktree_open_this = /** @type {(inputs: Worktree_Open_ThisInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Open this worktree`)
};

const zh_worktree_open_this = /** @type {(inputs: Worktree_Open_ThisInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`打开这个工作树`)
};

/**
* | output |
* | --- |
* | "Open this worktree" |
*
* @param {Worktree_Open_ThisInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_open_this = /** @type {((inputs?: Worktree_Open_ThisInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_Open_ThisInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_open_this(inputs)
	return en_worktree_open_this(inputs)
});