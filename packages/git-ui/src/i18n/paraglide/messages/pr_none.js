/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Pr_NoneInputs */

const en_pr_none = /** @type {(inputs: Pr_NoneInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No open pull requests.`)
};

const zh_pr_none = /** @type {(inputs: Pr_NoneInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`没有打开的拉取请求。`)
};

/**
* | output |
* | --- |
* | "No open pull requests." |
*
* @param {Pr_NoneInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pr_none = /** @type {((inputs?: Pr_NoneInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Pr_NoneInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_pr_none(inputs)
	return en_pr_none(inputs)
});