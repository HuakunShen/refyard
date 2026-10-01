/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Err_Read_WorktreesInputs */

const en_err_read_worktrees = /** @type {(inputs: Err_Read_WorktreesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Could not read worktrees`)
};

const zh_err_read_worktrees = /** @type {(inputs: Err_Read_WorktreesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`无法读取工作树`)
};

/**
* | output |
* | --- |
* | "Could not read worktrees" |
*
* @param {Err_Read_WorktreesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const err_read_worktrees = /** @type {((inputs?: Err_Read_WorktreesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Err_Read_WorktreesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_err_read_worktrees(inputs)
	return en_err_read_worktrees(inputs)
});