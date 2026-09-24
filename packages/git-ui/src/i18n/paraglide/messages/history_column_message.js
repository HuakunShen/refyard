/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} History_Column_MessageInputs */

const en_history_column_message = /** @type {(inputs: History_Column_MessageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Commit message`)
};

const zh_history_column_message = /** @type {(inputs: History_Column_MessageInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`提交信息`)
};

/**
* | output |
* | --- |
* | "Commit message" |
*
* @param {History_Column_MessageInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const history_column_message = /** @type {((inputs?: History_Column_MessageInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<History_Column_MessageInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_history_column_message(inputs)
	return en_history_column_message(inputs)
});