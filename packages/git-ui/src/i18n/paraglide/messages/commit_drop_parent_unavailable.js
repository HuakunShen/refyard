/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_Drop_Parent_UnavailableInputs */

const en_commit_drop_parent_unavailable = /** @type {(inputs: Commit_Drop_Parent_UnavailableInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`The parent commit is unavailable locally.`)
};

const zh_commit_drop_parent_unavailable = /** @type {(inputs: Commit_Drop_Parent_UnavailableInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`本地缺少父提交。`)
};

/**
* | output |
* | --- |
* | "The parent commit is unavailable locally." |
*
* @param {Commit_Drop_Parent_UnavailableInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_drop_parent_unavailable = /** @type {((inputs?: Commit_Drop_Parent_UnavailableInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_Drop_Parent_UnavailableInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_drop_parent_unavailable(inputs)
	return en_commit_drop_parent_unavailable(inputs)
});