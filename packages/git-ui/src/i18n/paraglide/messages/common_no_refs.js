/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Common_No_RefsInputs */

const en_common_no_refs = /** @type {(inputs: Common_No_RefsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No refs loaded.`)
};

const zh_common_no_refs = /** @type {(inputs: Common_No_RefsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`尚未加载任何引用。`)
};

/**
* | output |
* | --- |
* | "No refs loaded." |
*
* @param {Common_No_RefsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_no_refs = /** @type {((inputs?: Common_No_RefsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Common_No_RefsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_common_no_refs(inputs)
	return en_common_no_refs(inputs)
});