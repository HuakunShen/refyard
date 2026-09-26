/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} History_Column_GraphInputs */

const en_history_column_graph = /** @type {(inputs: History_Column_GraphInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Graph`)
};

const zh_history_column_graph = /** @type {(inputs: History_Column_GraphInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`图`)
};

/**
* | output |
* | --- |
* | "Graph" |
*
* @param {History_Column_GraphInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const history_column_graph = /** @type {((inputs?: History_Column_GraphInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<History_Column_GraphInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_history_column_graph(inputs)
	return en_history_column_graph(inputs)
});