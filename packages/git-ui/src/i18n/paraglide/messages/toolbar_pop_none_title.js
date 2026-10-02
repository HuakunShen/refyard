/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Toolbar_Pop_None_TitleInputs */

const en_toolbar_pop_none_title = /** @type {(inputs: Toolbar_Pop_None_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No stash to pop`)
};

const zh_toolbar_pop_none_title = /** @type {(inputs: Toolbar_Pop_None_TitleInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`没有可弹出的贮藏`)
};

/**
* | output |
* | --- |
* | "No stash to pop" |
*
* @param {Toolbar_Pop_None_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const toolbar_pop_none_title = /** @type {((inputs?: Toolbar_Pop_None_TitleInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Toolbar_Pop_None_TitleInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_toolbar_pop_none_title(inputs)
	return en_toolbar_pop_none_title(inputs)
});