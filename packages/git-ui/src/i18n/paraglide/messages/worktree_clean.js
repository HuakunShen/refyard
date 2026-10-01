/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_CleanInputs */

const en_worktree_clean = /** @type {(inputs: Worktree_CleanInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`clean`)
};

const zh_worktree_clean = /** @type {(inputs: Worktree_CleanInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`干净`)
};

/**
* | output |
* | --- |
* | "clean" |
*
* @param {Worktree_CleanInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_clean = /** @type {((inputs?: Worktree_CleanInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_CleanInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_clean(inputs)
	return en_worktree_clean(inputs)
});