/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_Scroll_MoreInputs */

const en_commit_scroll_more = /** @type {(inputs: Commit_Scroll_MoreInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Scroll for more`)
};

const zh_commit_scroll_more = /** @type {(inputs: Commit_Scroll_MoreInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`滚动查看更多`)
};

/**
* | output |
* | --- |
* | "Scroll for more" |
*
* @param {Commit_Scroll_MoreInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_scroll_more = /** @type {((inputs?: Commit_Scroll_MoreInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_Scroll_MoreInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_scroll_more(inputs)
	return en_commit_scroll_more(inputs)
});