/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Pr_RefreshInputs */

const en_pr_refresh = /** @type {(inputs: Pr_RefreshInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Refresh pull requests`)
};

const zh_pr_refresh = /** @type {(inputs: Pr_RefreshInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`刷新拉取请求`)
};

/**
* | output |
* | --- |
* | "Refresh pull requests" |
*
* @param {Pr_RefreshInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pr_refresh = /** @type {((inputs?: Pr_RefreshInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Pr_RefreshInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_pr_refresh(inputs)
	return en_pr_refresh(inputs)
});