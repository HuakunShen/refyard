/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Common_CollapseInputs */

const en_common_collapse = /** @type {(inputs: Common_CollapseInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Collapse`)
};

const zh_common_collapse = /** @type {(inputs: Common_CollapseInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`收起`)
};

/**
* | output |
* | --- |
* | "Collapse" |
*
* @param {Common_CollapseInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_collapse = /** @type {((inputs?: Common_CollapseInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Common_CollapseInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_common_collapse(inputs)
	return en_common_collapse(inputs)
});