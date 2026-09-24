/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sidebar_Working_CopyInputs */

const en_sidebar_working_copy = /** @type {(inputs: Sidebar_Working_CopyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Working Copy`)
};

const zh_sidebar_working_copy = /** @type {(inputs: Sidebar_Working_CopyInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`工作副本`)
};

/**
* | output |
* | --- |
* | "Working Copy" |
*
* @param {Sidebar_Working_CopyInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sidebar_working_copy = /** @type {((inputs?: Sidebar_Working_CopyInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sidebar_Working_CopyInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_sidebar_working_copy(inputs)
	return en_sidebar_working_copy(inputs)
});