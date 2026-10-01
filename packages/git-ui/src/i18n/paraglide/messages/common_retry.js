/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Common_RetryInputs */

const en_common_retry = /** @type {(inputs: Common_RetryInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Retry`)
};

const zh_common_retry = /** @type {(inputs: Common_RetryInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`重试`)
};

/**
* | output |
* | --- |
* | "Retry" |
*
* @param {Common_RetryInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_retry = /** @type {((inputs?: Common_RetryInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Common_RetryInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_common_retry(inputs)
	return en_common_retry(inputs)
});