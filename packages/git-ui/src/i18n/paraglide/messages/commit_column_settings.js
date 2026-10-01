/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_Column_SettingsInputs */

const en_commit_column_settings = /** @type {(inputs: Commit_Column_SettingsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Column settings`)
};

const zh_commit_column_settings = /** @type {(inputs: Commit_Column_SettingsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`列设置`)
};

/**
* | output |
* | --- |
* | "Column settings" |
*
* @param {Commit_Column_SettingsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_column_settings = /** @type {((inputs?: Commit_Column_SettingsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_Column_SettingsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_column_settings(inputs)
	return en_commit_column_settings(inputs)
});