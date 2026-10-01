/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Reset_Branch_HereInputs */

const en_reset_branch_here = /** @type {(inputs: Reset_Branch_HereInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Reset branch to here`)
};

const zh_reset_branch_here = /** @type {(inputs: Reset_Branch_HereInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`把分支重置到这里`)
};

/**
* | output |
* | --- |
* | "Reset branch to here" |
*
* @param {Reset_Branch_HereInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const reset_branch_here = /** @type {((inputs?: Reset_Branch_HereInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Reset_Branch_HereInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_reset_branch_here(inputs)
	return en_reset_branch_here(inputs)
});