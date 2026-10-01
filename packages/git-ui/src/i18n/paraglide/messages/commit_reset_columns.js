/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_Reset_ColumnsInputs */

const en_commit_reset_columns = /** @type {(inputs: Commit_Reset_ColumnsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Reset columns to default layout`)
};

const zh_commit_reset_columns = /** @type {(inputs: Commit_Reset_ColumnsInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`重置列为默认布局`)
};

/**
* | output |
* | --- |
* | "Reset columns to default layout" |
*
* @param {Commit_Reset_ColumnsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_reset_columns = /** @type {((inputs?: Commit_Reset_ColumnsInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_Reset_ColumnsInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_reset_columns(inputs)
	return en_commit_reset_columns(inputs)
});