/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Pr_ReadingInputs */

const en_pr_reading = /** @type {(inputs: Pr_ReadingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Reading pull requests…`)
};

const zh_pr_reading = /** @type {(inputs: Pr_ReadingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`正在读取拉取请求…`)
};

/**
* | output |
* | --- |
* | "Reading pull requests…" |
*
* @param {Pr_ReadingInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pr_reading = /** @type {((inputs?: Pr_ReadingInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Pr_ReadingInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_pr_reading(inputs)
	return en_pr_reading(inputs)
});