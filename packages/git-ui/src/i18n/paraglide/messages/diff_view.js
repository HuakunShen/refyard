/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Diff_ViewInputs */

const en_diff_view = /** @type {(inputs: Diff_ViewInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Diff view`)
};

const zh_diff_view = /** @type {(inputs: Diff_ViewInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`差异视图`)
};

/**
* | output |
* | --- |
* | "Diff view" |
*
* @param {Diff_ViewInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const diff_view = /** @type {((inputs?: Diff_ViewInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Diff_ViewInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_diff_view(inputs)
	return en_diff_view(inputs)
});