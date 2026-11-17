/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_Compact_GraphInputs */

const en_commit_compact_graph = /** @type {(inputs: Commit_Compact_GraphInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Compact Graph Column`)
};

const zh_commit_compact_graph = /** @type {(inputs: Commit_Compact_GraphInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`紧凑图形列`)
};

/**
* | output |
* | --- |
* | "Compact Graph Column" |
*
* @param {Commit_Compact_GraphInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_compact_graph = /** @type {((inputs?: Commit_Compact_GraphInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_Compact_GraphInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_compact_graph(inputs)
	return en_commit_compact_graph(inputs)
});