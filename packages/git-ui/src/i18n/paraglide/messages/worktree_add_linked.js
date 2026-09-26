/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_Add_LinkedInputs */

const en_worktree_add_linked = /** @type {(inputs: Worktree_Add_LinkedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Add linked worktree`)
};

const zh_worktree_add_linked = /** @type {(inputs: Worktree_Add_LinkedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`添加链接工作树`)
};

/**
* | output |
* | --- |
* | "Add linked worktree" |
*
* @param {Worktree_Add_LinkedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_add_linked = /** @type {((inputs?: Worktree_Add_LinkedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_Add_LinkedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_add_linked(inputs)
	return en_worktree_add_linked(inputs)
});