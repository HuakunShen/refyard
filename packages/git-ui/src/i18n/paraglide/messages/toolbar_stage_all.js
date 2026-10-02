/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Toolbar_Stage_AllInputs */

const en_toolbar_stage_all = /** @type {(inputs: Toolbar_Stage_AllInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Stage all changes`)
};

const zh_toolbar_stage_all = /** @type {(inputs: Toolbar_Stage_AllInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`暂存全部更改`)
};

/**
* | output |
* | --- |
* | "Stage all changes" |
*
* @param {Toolbar_Stage_AllInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const toolbar_stage_all = /** @type {((inputs?: Toolbar_Stage_AllInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Toolbar_Stage_AllInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_toolbar_stage_all(inputs)
	return en_toolbar_stage_all(inputs)
});