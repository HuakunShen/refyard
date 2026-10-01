/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Access_Approval_RequiredInputs */

const en_access_approval_required = /** @type {(inputs: Access_Approval_RequiredInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`approval required`)
};

const zh_access_approval_required = /** @type {(inputs: Access_Approval_RequiredInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`需要批准`)
};

/**
* | output |
* | --- |
* | "approval required" |
*
* @param {Access_Approval_RequiredInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const access_approval_required = /** @type {((inputs?: Access_Approval_RequiredInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Access_Approval_RequiredInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_access_approval_required(inputs)
	return en_access_approval_required(inputs)
});