/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Remote_Remove_EllipsisInputs */

const en_remote_remove_ellipsis = /** @type {(inputs: Remote_Remove_EllipsisInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Remove…`)
};

const zh_remote_remove_ellipsis = /** @type {(inputs: Remote_Remove_EllipsisInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`移除…`)
};

/**
* | output |
* | --- |
* | "Remove…" |
*
* @param {Remote_Remove_EllipsisInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const remote_remove_ellipsis = /** @type {((inputs?: Remote_Remove_EllipsisInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Remote_Remove_EllipsisInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_remote_remove_ellipsis(inputs)
	return en_remote_remove_ellipsis(inputs)
});