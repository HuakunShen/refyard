/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} History_Column_ShaInputs */

const en_history_column_sha = /** @type {(inputs: History_Column_ShaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`SHA`)
};

const zh_history_column_sha = /** @type {(inputs: History_Column_ShaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`SHA`)
};

/**
* | output |
* | --- |
* | "SHA" |
*
* @param {History_Column_ShaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const history_column_sha = /** @type {((inputs?: History_Column_ShaInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<History_Column_ShaInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_history_column_sha(inputs)
	return en_history_column_sha(inputs)
});