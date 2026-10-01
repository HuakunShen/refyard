/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Common_PushInputs */

const en_common_push = /** @type {(inputs: Common_PushInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Push`)
};

const zh_common_push = /** @type {(inputs: Common_PushInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`推送`)
};

/**
* | output |
* | --- |
* | "Push" |
*
* @param {Common_PushInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_push = /** @type {((inputs?: Common_PushInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Common_PushInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_common_push(inputs)
	return en_common_push(inputs)
});