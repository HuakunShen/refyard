/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Access_ManagedInputs */

const en_access_managed = /** @type {(inputs: Access_ManagedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Managed repositories`)
};

const zh_access_managed = /** @type {(inputs: Access_ManagedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`受管仓库`)
};

/**
* | output |
* | --- |
* | "Managed repositories" |
*
* @param {Access_ManagedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const access_managed = /** @type {((inputs?: Access_ManagedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Access_ManagedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_access_managed(inputs)
	return en_access_managed(inputs)
});