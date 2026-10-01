/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Split_No_ChangesInputs */

const en_split_no_changes = /** @type {(inputs: Split_No_ChangesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No line changes.`)
};

const zh_split_no_changes = /** @type {(inputs: Split_No_ChangesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`没有行变更。`)
};

/**
* | output |
* | --- |
* | "No line changes." |
*
* @param {Split_No_ChangesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const split_no_changes = /** @type {((inputs?: Split_No_ChangesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Split_No_ChangesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_split_no_changes(inputs)
	return en_split_no_changes(inputs)
});