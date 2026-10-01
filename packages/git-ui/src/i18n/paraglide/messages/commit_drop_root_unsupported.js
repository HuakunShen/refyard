/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_Drop_Root_UnsupportedInputs */

const en_commit_drop_root_unsupported = /** @type {(inputs: Commit_Drop_Root_UnsupportedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`The first commit cannot be dropped.`)
};

const zh_commit_drop_root_unsupported = /** @type {(inputs: Commit_Drop_Root_UnsupportedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`不能丢弃首个提交。`)
};

/**
* | output |
* | --- |
* | "The first commit cannot be dropped." |
*
* @param {Commit_Drop_Root_UnsupportedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_drop_root_unsupported = /** @type {((inputs?: Commit_Drop_Root_UnsupportedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_Drop_Root_UnsupportedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_drop_root_unsupported(inputs)
	return en_commit_drop_root_unsupported(inputs)
});