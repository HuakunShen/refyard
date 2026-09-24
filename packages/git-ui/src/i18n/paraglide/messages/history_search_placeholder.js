/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} History_Search_PlaceholderInputs */

const en_history_search_placeholder = /** @type {(inputs: History_Search_PlaceholderInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Search commit messages…`)
};

const zh_history_search_placeholder = /** @type {(inputs: History_Search_PlaceholderInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`搜索提交信息…`)
};

/**
* | output |
* | --- |
* | "Search commit messages…" |
*
* @param {History_Search_PlaceholderInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const history_search_placeholder = /** @type {((inputs?: History_Search_PlaceholderInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<History_Search_PlaceholderInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_history_search_placeholder(inputs)
	return en_history_search_placeholder(inputs)
});