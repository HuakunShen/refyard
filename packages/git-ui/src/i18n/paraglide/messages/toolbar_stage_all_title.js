/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{ n: NonNullable<unknown> }} Toolbar_Stage_All_TitleInputs */

const en_toolbar_stage_all_title = /** @type {(inputs: Toolbar_Stage_All_TitleInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`Stage all ${i?.n} changed path(s)`)
};

const zh_toolbar_stage_all_title = /** @type {(inputs: Toolbar_Stage_All_TitleInputs) => LocalizedString} */ (i) => {
	return /** @type {LocalizedString} */ (`暂存全部 ${i?.n} 个变更路径`)
};

/**
* | output |
* | --- |
* | "Stage all {n} changed path(s)" |
*
* @param {Toolbar_Stage_All_TitleInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const toolbar_stage_all_title = /** @type {((inputs: Toolbar_Stage_All_TitleInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Toolbar_Stage_All_TitleInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_toolbar_stage_all_title(inputs)
	return en_toolbar_stage_all_title(inputs)
});