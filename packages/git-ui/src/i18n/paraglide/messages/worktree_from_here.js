/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_From_HereInputs */

const en_worktree_from_here = /** @type {(inputs: Worktree_From_HereInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Create worktree from here`)
};

const zh_worktree_from_here = /** @type {(inputs: Worktree_From_HereInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`从这里创建工作树`)
};

/**
* | output |
* | --- |
* | "Create worktree from here" |
*
* @param {Worktree_From_HereInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_from_here = /** @type {((inputs?: Worktree_From_HereInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_From_HereInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_from_here(inputs)
	return en_worktree_from_here(inputs)
});