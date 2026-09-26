/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_LinkedInputs */

const en_worktree_linked = /** @type {(inputs: Worktree_LinkedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`linked`)
};

const zh_worktree_linked = /** @type {(inputs: Worktree_LinkedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`链接`)
};

/**
* | output |
* | --- |
* | "linked" |
*
* @param {Worktree_LinkedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_linked = /** @type {((inputs?: Worktree_LinkedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_LinkedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_linked(inputs)
	return en_worktree_linked(inputs)
});