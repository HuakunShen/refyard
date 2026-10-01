/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Stash_Aria_MessageInputs */

const en_stash_aria_message = /** @type {(inputs: Stash_Aria_MessageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`stash message`)
};

const zh_stash_aria_message = /** @type {(inputs: Stash_Aria_MessageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`贮藏信息`)
};

/**
* | output |
* | --- |
* | "stash message" |
*
* @param {Stash_Aria_MessageInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const stash_aria_message = /** @type {((inputs?: Stash_Aria_MessageInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stash_Aria_MessageInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_stash_aria_message(inputs)
	return en_stash_aria_message(inputs)
});