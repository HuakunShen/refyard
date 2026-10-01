/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Wip_TitleInputs */

const en_wip_title = /** @type {(inputs: Wip_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`WIP`)
};

const zh_wip_title = /** @type {(inputs: Wip_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`WIP`)
};

/**
* | output |
* | --- |
* | "WIP" |
*
* @param {Wip_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const wip_title = /** @type {((inputs?: Wip_TitleInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Wip_TitleInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_wip_title(inputs)
	return en_wip_title(inputs)
});