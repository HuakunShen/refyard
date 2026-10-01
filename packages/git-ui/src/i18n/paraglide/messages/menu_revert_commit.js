/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Menu_Revert_CommitInputs */

const en_menu_revert_commit = /** @type {(inputs: Menu_Revert_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Revert Commit…`)
};

const zh_menu_revert_commit = /** @type {(inputs: Menu_Revert_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`还原提交…`)
};

/**
* | output |
* | --- |
* | "Revert Commit…" |
*
* @param {Menu_Revert_CommitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_revert_commit = /** @type {((inputs?: Menu_Revert_CommitInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Menu_Revert_CommitInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_menu_revert_commit(inputs)
	return en_menu_revert_commit(inputs)
});