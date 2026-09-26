/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_Board_TitleInputs */

const en_worktree_board_title = /** @type {(inputs: Worktree_Board_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Worktrees`)
};

const zh_worktree_board_title = /** @type {(inputs: Worktree_Board_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`工作树`)
};

/**
* | output |
* | --- |
* | "Worktrees" |
*
* @param {Worktree_Board_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_board_title = /** @type {((inputs?: Worktree_Board_TitleInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_Board_TitleInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_board_title(inputs)
	return en_worktree_board_title(inputs)
});