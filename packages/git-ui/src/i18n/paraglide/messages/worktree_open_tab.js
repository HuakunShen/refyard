/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_Open_TabInputs */

const en_worktree_open_tab = /** @type {(inputs: Worktree_Open_TabInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Open worktree in new tab`)
};

const zh_worktree_open_tab = /** @type {(inputs: Worktree_Open_TabInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`在新标签页打开工作树`)
};

/**
* | output |
* | --- |
* | "Open worktree in new tab" |
*
* @param {Worktree_Open_TabInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_open_tab = /** @type {((inputs?: Worktree_Open_TabInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_Open_TabInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_open_tab(inputs)
	return en_worktree_open_tab(inputs)
});