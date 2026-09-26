/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Sidebar_RefsInputs */

const en_sidebar_refs = /** @type {(inputs: Sidebar_RefsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Refs`)
};

const zh_sidebar_refs = /** @type {(inputs: Sidebar_RefsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`引用`)
};

/**
* | output |
* | --- |
* | "Refs" |
*
* @param {Sidebar_RefsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sidebar_refs = /** @type {((inputs?: Sidebar_RefsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Sidebar_RefsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_sidebar_refs(inputs)
	return en_sidebar_refs(inputs)
});