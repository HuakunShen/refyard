/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Wip_AriaInputs */

const en_wip_aria = /** @type {(inputs: Wip_AriaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Worktree changes`)
};

const zh_wip_aria = /** @type {(inputs: Wip_AriaInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`工作树变更`)
};

/**
* | output |
* | --- |
* | "Worktree changes" |
*
* @param {Wip_AriaInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const wip_aria = /** @type {((inputs?: Wip_AriaInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Wip_AriaInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_wip_aria(inputs)
	return en_wip_aria(inputs)
});