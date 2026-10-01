/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Service_UnavailableInputs */

const en_service_unavailable = /** @type {(inputs: Service_UnavailableInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`The local service is unavailable`)
};

const zh_service_unavailable = /** @type {(inputs: Service_UnavailableInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`本地服务不可用`)
};

/**
* | output |
* | --- |
* | "The local service is unavailable" |
*
* @param {Service_UnavailableInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const service_unavailable = /** @type {((inputs?: Service_UnavailableInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Service_UnavailableInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_service_unavailable(inputs)
	return en_service_unavailable(inputs)
});