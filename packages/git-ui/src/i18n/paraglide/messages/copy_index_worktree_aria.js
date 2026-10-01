/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Copy_Index_Worktree_AriaInputs */

const en_copy_index_worktree_aria = /** @type {(inputs: Copy_Index_Worktree_AriaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`index / worktree status`)
};

const zh_copy_index_worktree_aria = /** @type {(inputs: Copy_Index_Worktree_AriaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`暂存区 / 工作树状态`)
};

/**
* | output |
* | --- |
* | "index / worktree status" |
*
* @param {Copy_Index_Worktree_AriaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_index_worktree_aria = /** @type {((inputs?: Copy_Index_Worktree_AriaInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Copy_Index_Worktree_AriaInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_copy_index_worktree_aria(inputs)
	return en_copy_index_worktree_aria(inputs)
});