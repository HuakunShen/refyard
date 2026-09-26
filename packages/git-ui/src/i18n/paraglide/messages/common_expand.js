/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Common_ExpandInputs */

const en_common_expand = /** @type {(inputs: Common_ExpandInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Expand`)
};

const zh_common_expand = /** @type {(inputs: Common_ExpandInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`展开`)
};

/**
* | output |
* | --- |
* | "Expand" |
*
* @param {Common_ExpandInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_expand = /** @type {((inputs?: Common_ExpandInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Common_ExpandInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_common_expand(inputs)
	return en_common_expand(inputs)
});