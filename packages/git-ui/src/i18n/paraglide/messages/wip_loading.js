/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Wip_LoadingInputs */

const en_wip_loading = /** @type {(inputs: Wip_LoadingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Loading…`)
};

const zh_wip_loading = /** @type {(inputs: Wip_LoadingInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`加载中…`)
};

/**
* | output |
* | --- |
* | "Loading…" |
*
* @param {Wip_LoadingInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const wip_loading = /** @type {((inputs?: Wip_LoadingInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Wip_LoadingInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_wip_loading(inputs)
	return en_wip_loading(inputs)
});