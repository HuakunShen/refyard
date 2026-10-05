/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Push_Upstream_SubmitInputs */

const en_push_upstream_submit = /** @type {(inputs: Push_Upstream_SubmitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Submit`)
};

const zh_push_upstream_submit = /** @type {(inputs: Push_Upstream_SubmitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`推送`)
};

/**
* | output |
* | --- |
* | "Submit" |
*
* @param {Push_Upstream_SubmitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const push_upstream_submit = /** @type {((inputs?: Push_Upstream_SubmitInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Upstream_SubmitInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_push_upstream_submit(inputs)
	return en_push_upstream_submit(inputs)
});