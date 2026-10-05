/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Push_Upstream_NoteInputs */

const en_push_upstream_note = /** @type {(inputs: Push_Upstream_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Sets upstream tracking, so later pushes and pulls go here without asking.`)
};

const zh_push_upstream_note = /** @type {(inputs: Push_Upstream_NoteInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`将设置上游跟踪，之后的推送和拉取都会使用这一选择。`)
};

/**
* | output |
* | --- |
* | "Sets upstream tracking, so later pushes and pulls go here without asking." |
*
* @param {Push_Upstream_NoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const push_upstream_note = /** @type {((inputs?: Push_Upstream_NoteInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Push_Upstream_NoteInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_push_upstream_note(inputs)
	return en_push_upstream_note(inputs)
});