/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Toolbar_PushInputs */

const en_toolbar_push = /** @type {(inputs: Toolbar_PushInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Push`)
};

const zh_toolbar_push = /** @type {(inputs: Toolbar_PushInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`推送`)
};

/**
* | output |
* | --- |
* | "Push" |
*
* @param {Toolbar_PushInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const toolbar_push = /** @type {((inputs?: Toolbar_PushInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Toolbar_PushInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_toolbar_push(inputs)
	return en_toolbar_push(inputs)
});