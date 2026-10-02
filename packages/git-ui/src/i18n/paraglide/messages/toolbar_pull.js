/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Toolbar_PullInputs */

const en_toolbar_pull = /** @type {(inputs: Toolbar_PullInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Pull`)
};

const zh_toolbar_pull = /** @type {(inputs: Toolbar_PullInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`更新`)
};

/**
* | output |
* | --- |
* | "Pull" |
*
* @param {Toolbar_PullInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const toolbar_pull = /** @type {((inputs?: Toolbar_PullInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Toolbar_PullInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_toolbar_pull(inputs)
	return en_toolbar_pull(inputs)
});