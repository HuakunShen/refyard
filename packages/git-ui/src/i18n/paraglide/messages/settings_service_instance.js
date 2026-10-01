/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Service_InstanceInputs */

const en_settings_service_instance = /** @type {(inputs: Settings_Service_InstanceInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Service instance`)
};

const zh_settings_service_instance = /** @type {(inputs: Settings_Service_InstanceInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`服务实例`)
};

/**
* | output |
* | --- |
* | "Service instance" |
*
* @param {Settings_Service_InstanceInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_service_instance = /** @type {((inputs?: Settings_Service_InstanceInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Service_InstanceInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_service_instance(inputs)
	return en_settings_service_instance(inputs)
});