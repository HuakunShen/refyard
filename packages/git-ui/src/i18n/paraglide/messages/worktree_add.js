/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_AddInputs */

const en_worktree_add = /** @type {(inputs: Worktree_AddInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Add worktree`)
};

const zh_worktree_add = /** @type {(inputs: Worktree_AddInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`添加工作树`)
};

/**
* | output |
* | --- |
* | "Add worktree" |
*
* @param {Worktree_AddInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_add = /** @type {((inputs?: Worktree_AddInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_AddInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_add(inputs)
	return en_worktree_add(inputs)
});