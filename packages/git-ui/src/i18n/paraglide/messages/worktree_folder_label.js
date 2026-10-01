/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_Folder_LabelInputs */

const en_worktree_folder_label = /** @type {(inputs: Worktree_Folder_LabelInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Worktree folder, relative to the approved root`)
};

const zh_worktree_folder_label = /** @type {(inputs: Worktree_Folder_LabelInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`工作树文件夹(相对于已批准的根目录)`)
};

/**
* | output |
* | --- |
* | "Worktree folder, relative to the approved root" |
*
* @param {Worktree_Folder_LabelInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_folder_label = /** @type {((inputs?: Worktree_Folder_LabelInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_Folder_LabelInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_folder_label(inputs)
	return en_worktree_folder_label(inputs)
});