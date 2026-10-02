/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Toolbar_No_UpstreamInputs */

const en_toolbar_no_upstream = /** @type {(inputs: Toolbar_No_UpstreamInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`No upstream configured for this branch`)
};

const zh_toolbar_no_upstream = /** @type {(inputs: Toolbar_No_UpstreamInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`当前分支没有配置上游`)
};

/**
* | output |
* | --- |
* | "No upstream configured for this branch" |
*
* @param {Toolbar_No_UpstreamInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const toolbar_no_upstream = /** @type {((inputs?: Toolbar_No_UpstreamInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Toolbar_No_UpstreamInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_toolbar_no_upstream(inputs)
	return en_toolbar_no_upstream(inputs)
});