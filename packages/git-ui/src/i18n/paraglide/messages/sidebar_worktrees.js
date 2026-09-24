/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sidebar_WorktreesInputs */

const en_sidebar_worktrees = /** @type {(inputs: Sidebar_WorktreesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Worktrees`)
};

const zh_sidebar_worktrees = /** @type {(inputs: Sidebar_WorktreesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`工作树`)
};

/**
* | output |
* | --- |
* | "Worktrees" |
*
* @param {Sidebar_WorktreesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sidebar_worktrees = /** @type {((inputs?: Sidebar_WorktreesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sidebar_WorktreesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_sidebar_worktrees(inputs)
	return en_sidebar_worktrees(inputs)
});