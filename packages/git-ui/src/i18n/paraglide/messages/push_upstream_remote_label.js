/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Push_Upstream_Remote_LabelInputs */

const en_push_upstream_remote_label = /** @type {(inputs: Push_Upstream_Remote_LabelInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Remote`)
};

const zh_push_upstream_remote_label = /** @type {(inputs: Push_Upstream_Remote_LabelInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`远程`)
};

/**
* | output |
* | --- |
* | "Remote" |
*
* @param {Push_Upstream_Remote_LabelInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const push_upstream_remote_label = /** @type {((inputs?: Push_Upstream_Remote_LabelInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Upstream_Remote_LabelInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_push_upstream_remote_label(inputs)
	return en_push_upstream_remote_label(inputs)
});