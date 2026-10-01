/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Branch_Delete_EllipsisInputs */

const en_branch_delete_ellipsis = /** @type {(inputs: Branch_Delete_EllipsisInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Delete…`)
};

const zh_branch_delete_ellipsis = /** @type {(inputs: Branch_Delete_EllipsisInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`删除…`)
};

/**
* | output |
* | --- |
* | "Delete…" |
*
* @param {Branch_Delete_EllipsisInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const branch_delete_ellipsis = /** @type {((inputs?: Branch_Delete_EllipsisInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Branch_Delete_EllipsisInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_branch_delete_ellipsis(inputs)
	return en_branch_delete_ellipsis(inputs)
});