/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Filters_Name_Or_EmailInputs */

const en_filters_name_or_email = /** @type {(inputs: Filters_Name_Or_EmailInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Name or email`)
};

const zh_filters_name_or_email = /** @type {(inputs: Filters_Name_Or_EmailInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`姓名或邮箱`)
};

/**
* | output |
* | --- |
* | "Name or email" |
*
* @param {Filters_Name_Or_EmailInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const filters_name_or_email = /** @type {((inputs?: Filters_Name_Or_EmailInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Filters_Name_Or_EmailInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_filters_name_or_email(inputs)
	return en_filters_name_or_email(inputs)
});