/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Wip_Working_CopiesInputs */

const en_wip_working_copies = /** @type {(inputs: Wip_Working_CopiesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Working copies`)
};

const zh_wip_working_copies = /** @type {(inputs: Wip_Working_CopiesInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`工作副本`)
};

/**
* | output |
* | --- |
* | "Working copies" |
*
* @param {Wip_Working_CopiesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const wip_working_copies = /** @type {((inputs?: Wip_Working_CopiesInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Wip_Working_CopiesInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_wip_working_copies(inputs)
	return en_wip_working_copies(inputs)
});