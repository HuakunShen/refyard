/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Copy_Discard_HintInputs */

const en_copy_discard_hint = /** @type {(inputs: Copy_Discard_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Restore this tracked path to the index version. Refyard writes a recovery backup before changing the working tree.`)
};

const zh_copy_discard_hint = /** @type {(inputs: Copy_Discard_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`把这个已跟踪文件恢复到暂存区版本。Refyard 会在改动工作树之前先写一份恢复备份。`)
};

/**
* | output |
* | --- |
* | "Restore this tracked path to the index version. Refyard writes a recovery backup before changing the working tree." |
*
* @param {Copy_Discard_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_discard_hint = /** @type {((inputs?: Copy_Discard_HintInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Copy_Discard_HintInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_copy_discard_hint(inputs)
	return en_copy_discard_hint(inputs)
});