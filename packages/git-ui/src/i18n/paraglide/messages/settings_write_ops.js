/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Settings_Write_OpsInputs */

const en_settings_write_ops = /** @type {(inputs: Settings_Write_OpsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Write operations`)
};

const zh_settings_write_ops = /** @type {(inputs: Settings_Write_OpsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`写入操作`)
};

/**
* | output |
* | --- |
* | "Write operations" |
*
* @param {Settings_Write_OpsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const settings_write_ops = /** @type {((inputs?: Settings_Write_OpsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Settings_Write_OpsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_settings_write_ops(inputs)
	return en_settings_write_ops(inputs)
});