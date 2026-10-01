/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Pr_Disconnect_TitleInputs */

const en_pr_disconnect_title = /** @type {(inputs: Pr_Disconnect_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Disconnect this account`)
};

const zh_pr_disconnect_title = /** @type {(inputs: Pr_Disconnect_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`断开此账号`)
};

/**
* | output |
* | --- |
* | "Disconnect this account" |
*
* @param {Pr_Disconnect_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const pr_disconnect_title = /** @type {((inputs?: Pr_Disconnect_TitleInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Pr_Disconnect_TitleInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_pr_disconnect_title(inputs)
	return en_pr_disconnect_title(inputs)
});