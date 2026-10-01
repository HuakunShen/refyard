/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sub_Status_TitleInputs */

const en_sub_status_title = /** @type {(inputs: Sub_Status_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`HEAD / index / checkout`)
};

const zh_sub_status_title = /** @type {(inputs: Sub_Status_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`HEAD / 暂存区 / 检出`)
};

/**
* | output |
* | --- |
* | "HEAD / index / checkout" |
*
* @param {Sub_Status_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sub_status_title = /** @type {((inputs?: Sub_Status_TitleInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sub_Status_TitleInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_sub_status_title(inputs)
	return en_sub_status_title(inputs)
});