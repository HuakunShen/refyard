/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Conflict_Resolution_HintInputs */

const en_conflict_resolution_hint = /** @type {(inputs: Conflict_Resolution_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Resolve these files outside Refyard, stage the results with the staging panel above, then continue. Nothing here edits a conflicted file.`)
};

const zh_conflict_resolution_hint = /** @type {(inputs: Conflict_Resolution_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`在 Refyard 外解决这些文件的冲突，使用上方的暂存面板暂存结果，然后继续操作。这里不会编辑冲突文件。`)
};

/**
* | output |
* | --- |
* | "Resolve these files outside Refyard, stage the results with the staging panel above, then continue. Nothing here edits a conflicted file." |
*
* @param {Conflict_Resolution_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_resolution_hint = /** @type {((inputs?: Conflict_Resolution_HintInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conflict_Resolution_HintInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conflict_resolution_hint(inputs)
	return en_conflict_resolution_hint(inputs)
});