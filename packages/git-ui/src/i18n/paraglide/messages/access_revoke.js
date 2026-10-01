/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Access_RevokeInputs */

const en_access_revoke = /** @type {(inputs: Access_RevokeInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Revoke`)
};

const zh_access_revoke = /** @type {(inputs: Access_RevokeInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`撤销`)
};

/**
* | output |
* | --- |
* | "Revoke" |
*
* @param {Access_RevokeInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const access_revoke = /** @type {((inputs?: Access_RevokeInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Access_RevokeInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_access_revoke(inputs)
	return en_access_revoke(inputs)
});