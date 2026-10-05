/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Toolbar_Push_Set_UpstreamInputs */

const en_toolbar_push_set_upstream = /** @type {(inputs: Toolbar_Push_Set_UpstreamInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Choose where this branch pushes`)
};

const zh_toolbar_push_set_upstream = /** @type {(inputs: Toolbar_Push_Set_UpstreamInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`选择此分支的推送目标`)
};

/**
* | output |
* | --- |
* | "Choose where this branch pushes" |
*
* @param {Toolbar_Push_Set_UpstreamInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const toolbar_push_set_upstream = /** @type {((inputs?: Toolbar_Push_Set_UpstreamInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Toolbar_Push_Set_UpstreamInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_toolbar_push_set_upstream(inputs)
	return en_toolbar_push_set_upstream(inputs)
});