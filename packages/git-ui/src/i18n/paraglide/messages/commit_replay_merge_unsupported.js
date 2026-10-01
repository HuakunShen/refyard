/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Commit_Replay_Merge_UnsupportedInputs */

const en_commit_replay_merge_unsupported = /** @type {(inputs: Commit_Replay_Merge_UnsupportedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`This operation does not support merge commits.`)
};

const zh_commit_replay_merge_unsupported = /** @type {(inputs: Commit_Replay_Merge_UnsupportedInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`此操作不支持合并提交。`)
};

/**
* | output |
* | --- |
* | "This operation does not support merge commits." |
*
* @param {Commit_Replay_Merge_UnsupportedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const commit_replay_merge_unsupported = /** @type {((inputs?: Commit_Replay_Merge_UnsupportedInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Commit_Replay_Merge_UnsupportedInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_commit_replay_merge_unsupported(inputs)
	return en_commit_replay_merge_unsupported(inputs)
});