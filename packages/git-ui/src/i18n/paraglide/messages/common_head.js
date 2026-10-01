/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Common_HeadInputs */

const en_common_head = /** @type {(inputs: Common_HeadInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`HEAD`)
};

const zh_common_head = /** @type {(inputs: Common_HeadInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`HEAD`)
};

/**
* | output |
* | --- |
* | "HEAD" |
*
* @param {Common_HeadInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_head = /** @type {((inputs?: Common_HeadInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Common_HeadInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_common_head(inputs)
	return en_common_head(inputs)
});