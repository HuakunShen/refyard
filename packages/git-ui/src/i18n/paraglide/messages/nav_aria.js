/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Nav_AriaInputs */

const en_nav_aria = /** @type {(inputs: Nav_AriaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Repository navigation`)
};

const zh_nav_aria = /** @type {(inputs: Nav_AriaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`仓库导航`)
};

/**
* | output |
* | --- |
* | "Repository navigation" |
*
* @param {Nav_AriaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const nav_aria = /** @type {((inputs?: Nav_AriaInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Nav_AriaInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_nav_aria(inputs)
	return en_nav_aria(inputs)
});