/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_PrimaryInputs */

const en_worktree_primary = /** @type {(inputs: Worktree_PrimaryInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`primary`)
};

const zh_worktree_primary = /** @type {(inputs: Worktree_PrimaryInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`主工作树`)
};

/**
* | output |
* | --- |
* | "primary" |
*
* @param {Worktree_PrimaryInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_primary = /** @type {((inputs?: Worktree_PrimaryInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_PrimaryInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_primary(inputs)
	return en_worktree_primary(inputs)
});