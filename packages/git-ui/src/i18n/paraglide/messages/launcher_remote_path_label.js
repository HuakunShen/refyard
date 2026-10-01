/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Launcher_Remote_Path_LabelInputs */

const en_launcher_remote_path_label = /** @type {(inputs: Launcher_Remote_Path_LabelInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Remote repository path`)
};

const zh_launcher_remote_path_label = /** @type {(inputs: Launcher_Remote_Path_LabelInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`远程仓库路径`)
};

/**
* | output |
* | --- |
* | "Remote repository path" |
*
* @param {Launcher_Remote_Path_LabelInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_remote_path_label = /** @type {((inputs?: Launcher_Remote_Path_LabelInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Launcher_Remote_Path_LabelInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_launcher_remote_path_label(inputs)
	return en_launcher_remote_path_label(inputs)
});