/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Menu_Drop_CommitInputs */

const en_menu_drop_commit = /** @type {(inputs: Menu_Drop_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Drop Commit…`)
};

const zh_menu_drop_commit = /** @type {(inputs: Menu_Drop_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`丢弃提交…`)
};

/**
* | output |
* | --- |
* | "Drop Commit…" |
*
* @param {Menu_Drop_CommitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_drop_commit = /** @type {((inputs?: Menu_Drop_CommitInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Menu_Drop_CommitInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_menu_drop_commit(inputs)
	return en_menu_drop_commit(inputs)
});