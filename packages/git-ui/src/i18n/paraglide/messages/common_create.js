/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Common_CreateInputs */

const en_common_create = /** @type {(inputs: Common_CreateInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Create`)
};

const zh_common_create = /** @type {(inputs: Common_CreateInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`创建`)
};

/**
* | output |
* | --- |
* | "Create" |
*
* @param {Common_CreateInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_create = /** @type {((inputs?: Common_CreateInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Common_CreateInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_common_create(inputs)
	return en_common_create(inputs)
});