/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Stash_Placeholder_MessageInputs */

const en_stash_placeholder_message = /** @type {(inputs: Stash_Placeholder_MessageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`stash message (optional)`)
};

const zh_stash_placeholder_message = /** @type {(inputs: Stash_Placeholder_MessageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`贮藏信息(可选)`)
};

/**
* | output |
* | --- |
* | "stash message (optional)" |
*
* @param {Stash_Placeholder_MessageInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const stash_placeholder_message = /** @type {((inputs?: Stash_Placeholder_MessageInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Stash_Placeholder_MessageInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_stash_placeholder_message(inputs)
	return en_stash_placeholder_message(inputs)
});