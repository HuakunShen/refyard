/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Loading_WorktreesInputs */

const en_loading_worktrees = /** @type {(inputs: Loading_WorktreesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Reading worktrees…`)
};

const zh_loading_worktrees = /** @type {(inputs: Loading_WorktreesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`正在读取工作树…`)
};

/**
* | output |
* | --- |
* | "Reading worktrees…" |
*
* @param {Loading_WorktreesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const loading_worktrees = /** @type {((inputs?: Loading_WorktreesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Loading_WorktreesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_loading_worktrees(inputs)
	return en_loading_worktrees(inputs)
});