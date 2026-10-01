/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Worktree_Aria_DestinationInputs */

const en_worktree_aria_destination = /** @type {(inputs: Worktree_Aria_DestinationInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`worktree destination`)
};

const zh_worktree_aria_destination = /** @type {(inputs: Worktree_Aria_DestinationInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`工作树目标路径`)
};

/**
* | output |
* | --- |
* | "worktree destination" |
*
* @param {Worktree_Aria_DestinationInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const worktree_aria_destination = /** @type {((inputs?: Worktree_Aria_DestinationInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Worktree_Aria_DestinationInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_worktree_aria_destination(inputs)
	return en_worktree_aria_destination(inputs)
});