/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Drop_CommitInputs */

const en_drop_commit = /** @type {(inputs: Drop_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Drop commit`)
};

const zh_drop_commit = /** @type {(inputs: Drop_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`丢弃提交`)
};

/**
* | output |
* | --- |
* | "Drop commit" |
*
* @param {Drop_CommitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const drop_commit = /** @type {((inputs?: Drop_CommitInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Drop_CommitInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_drop_commit(inputs)
	return en_drop_commit(inputs)
});