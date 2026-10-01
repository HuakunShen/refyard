/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Pr_DraftInputs */

const en_pr_draft = /** @type {(inputs: Pr_DraftInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`draft`)
};

const zh_pr_draft = /** @type {(inputs: Pr_DraftInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`草稿`)
};

/**
* | output |
* | --- |
* | "draft" |
*
* @param {Pr_DraftInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pr_draft = /** @type {((inputs?: Pr_DraftInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Pr_DraftInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_pr_draft(inputs)
	return en_pr_draft(inputs)
});