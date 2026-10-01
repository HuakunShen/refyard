/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Status_NoneInputs */

const en_status_none = /** @type {(inputs: Status_NoneInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No status loaded.`)
};

const zh_status_none = /** @type {(inputs: Status_NoneInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`尚未加载状态。`)
};

/**
* | output |
* | --- |
* | "No status loaded." |
*
* @param {Status_NoneInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const status_none = /** @type {((inputs?: Status_NoneInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Status_NoneInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_status_none(inputs)
	return en_status_none(inputs)
});