/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Updates_Check_AutoInputs */

const en_updates_check_auto = /** @type {(inputs: Updates_Check_AutoInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Check automatically when the app starts`)
};

const zh_updates_check_auto = /** @type {(inputs: Updates_Check_AutoInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`应用启动时自动检查`)
};

/**
* | output |
* | --- |
* | "Check automatically when the app starts" |
*
* @param {Updates_Check_AutoInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const updates_check_auto = /** @type {((inputs?: Updates_Check_AutoInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Updates_Check_AutoInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_updates_check_auto(inputs)
	return en_updates_check_auto(inputs)
});