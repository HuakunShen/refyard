/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Updates_Download_InstallInputs */

const en_updates_download_install = /** @type {(inputs: Updates_Download_InstallInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Download and install`)
};

const zh_updates_download_install = /** @type {(inputs: Updates_Download_InstallInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`下载并安装`)
};

/**
* | output |
* | --- |
* | "Download and install" |
*
* @param {Updates_Download_InstallInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const updates_download_install = /** @type {((inputs?: Updates_Download_InstallInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Updates_Download_InstallInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_updates_download_install(inputs)
	return en_updates_download_install(inputs)
});