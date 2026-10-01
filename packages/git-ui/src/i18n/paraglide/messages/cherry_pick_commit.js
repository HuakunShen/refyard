/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Cherry_Pick_CommitInputs */

const en_cherry_pick_commit = /** @type {(inputs: Cherry_Pick_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Cherry-pick commit`)
};

const zh_cherry_pick_commit = /** @type {(inputs: Cherry_Pick_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`摘取提交`)
};

/**
* | output |
* | --- |
* | "Cherry-pick commit" |
*
* @param {Cherry_Pick_CommitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const cherry_pick_commit = /** @type {((inputs?: Cherry_Pick_CommitInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Cherry_Pick_CommitInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_cherry_pick_commit(inputs)
	return en_cherry_pick_commit(inputs)
});