/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_Expand_GraphInputs */

const en_commit_expand_graph = /** @type {(inputs: Commit_Expand_GraphInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Expand Graph Column`)
};

const zh_commit_expand_graph = /** @type {(inputs: Commit_Expand_GraphInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`展开图形列`)
};

/**
* | output |
* | --- |
* | "Expand Graph Column" |
*
* @param {Commit_Expand_GraphInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_expand_graph = /** @type {((inputs?: Commit_Expand_GraphInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_Expand_GraphInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_expand_graph(inputs)
	return en_commit_expand_graph(inputs)
});