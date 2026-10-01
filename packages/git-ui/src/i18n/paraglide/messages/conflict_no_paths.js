/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Conflict_No_PathsInputs */

const en_conflict_no_paths = /** @type {(inputs: Conflict_No_PathsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`no conflicted paths remain`)
};

const zh_conflict_no_paths = /** @type {(inputs: Conflict_No_PathsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`已无冲突文件`)
};

/**
* | output |
* | --- |
* | "no conflicted paths remain" |
*
* @param {Conflict_No_PathsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_no_paths = /** @type {((inputs?: Conflict_No_PathsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conflict_No_PathsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conflict_no_paths(inputs)
	return en_conflict_no_paths(inputs)
});