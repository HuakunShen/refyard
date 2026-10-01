/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Common_Edit_EllipsisInputs */

const en_common_edit_ellipsis = /** @type {(inputs: Common_Edit_EllipsisInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Edit…`)
};

const zh_common_edit_ellipsis = /** @type {(inputs: Common_Edit_EllipsisInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`编辑…`)
};

/**
* | output |
* | --- |
* | "Edit…" |
*
* @param {Common_Edit_EllipsisInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const common_edit_ellipsis = /** @type {((inputs?: Common_Edit_EllipsisInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Common_Edit_EllipsisInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_common_edit_ellipsis(inputs)
	return en_common_edit_ellipsis(inputs)
});