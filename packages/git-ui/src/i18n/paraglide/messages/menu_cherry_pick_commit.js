/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Menu_Cherry_Pick_CommitInputs */

const en_menu_cherry_pick_commit = /** @type {(inputs: Menu_Cherry_Pick_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Cherry-Pick Commit…`)
};

const zh_menu_cherry_pick_commit = /** @type {(inputs: Menu_Cherry_Pick_CommitInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`摘取提交…`)
};

/**
* | output |
* | --- |
* | "Cherry-Pick Commit…" |
*
* @param {Menu_Cherry_Pick_CommitInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const menu_cherry_pick_commit = /** @type {((inputs?: Menu_Cherry_Pick_CommitInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Menu_Cherry_Pick_CommitInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_menu_cherry_pick_commit(inputs)
	return en_menu_cherry_pick_commit(inputs)
});