/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Remote_Aria_NameInputs */

const en_remote_aria_name = /** @type {(inputs: Remote_Aria_NameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`remote name`)
};

const zh_remote_aria_name = /** @type {(inputs: Remote_Aria_NameInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`远程名称`)
};

/**
* | output |
* | --- |
* | "remote name" |
*
* @param {Remote_Aria_NameInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_aria_name = /** @type {((inputs?: Remote_Aria_NameInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Remote_Aria_NameInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_remote_aria_name(inputs)
	return en_remote_aria_name(inputs)
});