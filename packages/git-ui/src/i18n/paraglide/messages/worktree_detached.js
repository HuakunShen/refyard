/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_DetachedInputs */

const en_worktree_detached = /** @type {(inputs: Worktree_DetachedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`detached commit`)
};

const zh_worktree_detached = /** @type {(inputs: Worktree_DetachedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`游离提交`)
};

/**
* | output |
* | --- |
* | "detached commit" |
*
* @param {Worktree_DetachedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_detached = /** @type {((inputs?: Worktree_DetachedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_DetachedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_detached(inputs)
	return en_worktree_detached(inputs)
});