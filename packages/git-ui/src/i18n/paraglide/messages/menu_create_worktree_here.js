/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Menu_Create_Worktree_HereInputs */

const en_menu_create_worktree_here = /** @type {(inputs: Menu_Create_Worktree_HereInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Create Worktree from Here…`)
};

const zh_menu_create_worktree_here = /** @type {(inputs: Menu_Create_Worktree_HereInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`从这里创建工作树…`)
};

/**
* | output |
* | --- |
* | "Create Worktree from Here…" |
*
* @param {Menu_Create_Worktree_HereInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_create_worktree_here = /** @type {((inputs?: Menu_Create_Worktree_HereInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Menu_Create_Worktree_HereInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_menu_create_worktree_here(inputs)
	return en_menu_create_worktree_here(inputs)
});