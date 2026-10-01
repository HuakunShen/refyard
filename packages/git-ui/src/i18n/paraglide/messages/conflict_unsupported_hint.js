/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Conflict_Unsupported_HintInputs */

const en_conflict_unsupported_hint = /** @type {(inputs: Conflict_Unsupported_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`This build does not support continuing or aborting this operation. Finish it with Git or the tool that started it; writes stay blocked in this worktree until the state is resolved.`)
};

const zh_conflict_unsupported_hint = /** @type {(inputs: Conflict_Unsupported_HintInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`此版本不支持继续或中止该操作。请使用 Git 或启动该操作的工具完成或中止它；在状态解决前，此工作树的写入操作保持禁用。`)
};

/**
* | output |
* | --- |
* | "This build does not support continuing or aborting this operation. Finish it with Git or the tool that started it; writes stay blocked in this worktree until..." |
*
* @param {Conflict_Unsupported_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_unsupported_hint = /** @type {((inputs?: Conflict_Unsupported_HintInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Conflict_Unsupported_HintInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_conflict_unsupported_hint(inputs)
	return en_conflict_unsupported_hint(inputs)
});