/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Page_Install_RestartInputs */

const en_page_install_restart = /** @type {(inputs: Page_Install_RestartInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Install and restart`)
};

const zh_page_install_restart = /** @type {(inputs: Page_Install_RestartInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`安装并重启`)
};

/**
* | output |
* | --- |
* | "Install and restart" |
*
* @param {Page_Install_RestartInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const page_install_restart = /** @type {((inputs?: Page_Install_RestartInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Page_Install_RestartInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_page_install_restart(inputs)
	return en_page_install_restart(inputs)
});