/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Stash_Aria_UntrackedInputs */

const en_stash_aria_untracked = /** @type {(inputs: Stash_Aria_UntrackedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`include untracked files`)
};

const zh_stash_aria_untracked = /** @type {(inputs: Stash_Aria_UntrackedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`包含未跟踪文件`)
};

/**
* | output |
* | --- |
* | "include untracked files" |
*
* @param {Stash_Aria_UntrackedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const stash_aria_untracked = /** @type {((inputs?: Stash_Aria_UntrackedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stash_Aria_UntrackedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_stash_aria_untracked(inputs)
	return en_stash_aria_untracked(inputs)
});