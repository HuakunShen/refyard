/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_Relative_PathInputs */

const en_worktree_relative_path = /** @type {(inputs: Worktree_Relative_PathInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`relative/path`)
};

const zh_worktree_relative_path = /** @type {(inputs: Worktree_Relative_PathInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`相对路径`)
};

/**
* | output |
* | --- |
* | "relative/path" |
*
* @param {Worktree_Relative_PathInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_relative_path = /** @type {((inputs?: Worktree_Relative_PathInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_Relative_PathInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_relative_path(inputs)
	return en_worktree_relative_path(inputs)
});