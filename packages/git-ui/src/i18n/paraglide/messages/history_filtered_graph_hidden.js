/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} History_Filtered_Graph_HiddenInputs */

const en_history_filtered_graph_hidden = /** @type {(inputs: History_Filtered_Graph_HiddenInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Filtered history · graph hidden`)
};

const zh_history_filtered_graph_hidden = /** @type {(inputs: History_Filtered_Graph_HiddenInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`历史已筛选 · 图已隐藏`)
};

/**
* | output |
* | --- |
* | "Filtered history · graph hidden" |
*
* @param {History_Filtered_Graph_HiddenInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const history_filtered_graph_hidden = /** @type {((inputs?: History_Filtered_Graph_HiddenInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<History_Filtered_Graph_HiddenInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_history_filtered_graph_hidden(inputs)
	return en_history_filtered_graph_hidden(inputs)
});