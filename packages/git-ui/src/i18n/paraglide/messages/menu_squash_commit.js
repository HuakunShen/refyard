/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Menu_Squash_CommitInputs */

const en_menu_squash_commit = /** @type {(inputs: Menu_Squash_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Squash into Parent…`)
};

const zh_menu_squash_commit = /** @type {(inputs: Menu_Squash_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`并入父提交…`)
};

/**
* | output |
* | --- |
* | "Squash into Parent…" |
*
* @param {Menu_Squash_CommitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_squash_commit = /** @type {((inputs?: Menu_Squash_CommitInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Menu_Squash_CommitInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_menu_squash_commit(inputs)
	return en_menu_squash_commit(inputs)
});