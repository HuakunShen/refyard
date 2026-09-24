/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_Stage_FileInputs */

const en_commit_stage_file = /** @type {(inputs: Commit_Stage_FileInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Stage file`)
};

const zh_commit_stage_file = /** @type {(inputs: Commit_Stage_FileInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`暂存文件`)
};

/**
* | output |
* | --- |
* | "Stage file" |
*
* @param {Commit_Stage_FileInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_stage_file = /** @type {((inputs?: Commit_Stage_FileInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_Stage_FileInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_stage_file(inputs)
	return en_commit_stage_file(inputs)
});