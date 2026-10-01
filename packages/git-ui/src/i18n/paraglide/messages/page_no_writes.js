/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Page_No_WritesInputs */

const en_page_no_writes = /** @type {(inputs: Page_No_WritesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No write operations: no route, no capability, no button.`)
};

const zh_page_no_writes = /** @type {(inputs: Page_No_WritesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`无写入操作:无路由、无能力、无按钮。`)
};

/**
* | output |
* | --- |
* | "No write operations: no route, no capability, no button." |
*
* @param {Page_No_WritesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const page_no_writes = /** @type {((inputs?: Page_No_WritesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Page_No_WritesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_page_no_writes(inputs)
	return en_page_no_writes(inputs)
});