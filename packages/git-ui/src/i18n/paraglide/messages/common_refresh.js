/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Common_RefreshInputs */

const en_common_refresh = /** @type {(inputs: Common_RefreshInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Refresh`)
};

const zh_common_refresh = /** @type {(inputs: Common_RefreshInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`刷新`)
};

/**
* | output |
* | --- |
* | "Refresh" |
*
* @param {Common_RefreshInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_refresh = /** @type {((inputs?: Common_RefreshInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Common_RefreshInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_common_refresh(inputs)
	return en_common_refresh(inputs)
});