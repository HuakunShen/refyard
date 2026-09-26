/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} History_Column_BranchInputs */

const en_history_column_branch = /** @type {(inputs: History_Column_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Branch / Tag`)
};

const zh_history_column_branch = /** @type {(inputs: History_Column_BranchInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`分支 / 标签`)
};

/**
* | output |
* | --- |
* | "Branch / Tag" |
*
* @param {History_Column_BranchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const history_column_branch = /** @type {((inputs?: History_Column_BranchInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<History_Column_BranchInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_history_column_branch(inputs)
	return en_history_column_branch(inputs)
});