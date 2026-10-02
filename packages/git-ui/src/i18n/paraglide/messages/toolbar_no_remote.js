/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Toolbar_No_RemoteInputs */

const en_toolbar_no_remote = /** @type {(inputs: Toolbar_No_RemoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No remote is configured for this repository`)
};

const zh_toolbar_no_remote = /** @type {(inputs: Toolbar_No_RemoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`此仓库没有配置远程`)
};

/**
* | output |
* | --- |
* | "No remote is configured for this repository" |
*
* @param {Toolbar_No_RemoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const toolbar_no_remote = /** @type {((inputs?: Toolbar_No_RemoteInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Toolbar_No_RemoteInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_toolbar_no_remote(inputs)
	return en_toolbar_no_remote(inputs)
});