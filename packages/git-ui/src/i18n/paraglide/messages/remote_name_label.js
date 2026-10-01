/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Remote_Name_LabelInputs */

const en_remote_name_label = /** @type {(inputs: Remote_Name_LabelInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Name`)
};

const zh_remote_name_label = /** @type {(inputs: Remote_Name_LabelInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`名称`)
};

/**
* | output |
* | --- |
* | "Name" |
*
* @param {Remote_Name_LabelInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_name_label = /** @type {((inputs?: Remote_Name_LabelInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Remote_Name_LabelInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_remote_name_label(inputs)
	return en_remote_name_label(inputs)
});