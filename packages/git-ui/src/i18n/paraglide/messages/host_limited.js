/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Host_LimitedInputs */

const en_host_limited = /** @type {(inputs: Host_LimitedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`The host limited this listing`)
};

const zh_host_limited = /** @type {(inputs: Host_LimitedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`宿主限制了此列表`)
};

/**
* | output |
* | --- |
* | "The host limited this listing" |
*
* @param {Host_LimitedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const host_limited = /** @type {((inputs?: Host_LimitedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Host_LimitedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_host_limited(inputs)
	return en_host_limited(inputs)
});