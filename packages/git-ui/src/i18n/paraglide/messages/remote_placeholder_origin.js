/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Remote_Placeholder_OriginInputs */

const en_remote_placeholder_origin = /** @type {(inputs: Remote_Placeholder_OriginInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`origin`)
};

const zh_remote_placeholder_origin = /** @type {(inputs: Remote_Placeholder_OriginInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`origin`)
};

/**
* | output |
* | --- |
* | "origin" |
*
* @param {Remote_Placeholder_OriginInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_placeholder_origin = /** @type {((inputs?: Remote_Placeholder_OriginInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Remote_Placeholder_OriginInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_remote_placeholder_origin(inputs)
	return en_remote_placeholder_origin(inputs)
});