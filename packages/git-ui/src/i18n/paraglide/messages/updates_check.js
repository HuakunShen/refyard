/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Updates_CheckInputs */

const en_updates_check = /** @type {(inputs: Updates_CheckInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Check for updates`)
};

const zh_updates_check = /** @type {(inputs: Updates_CheckInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`检查更新`)
};

/**
* | output |
* | --- |
* | "Check for updates" |
*
* @param {Updates_CheckInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const updates_check = /** @type {((inputs?: Updates_CheckInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Updates_CheckInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_updates_check(inputs)
	return en_updates_check(inputs)
});