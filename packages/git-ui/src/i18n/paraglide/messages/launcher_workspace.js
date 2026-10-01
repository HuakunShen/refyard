/* eslint-disable */
import { getLocale, experimentalStaticLocale } from '../runtime.js';

/** @typedef {import('../runtime.js').LocalizedString} LocalizedString */

/** @typedef {{}} Launcher_WorkspaceInputs */

const en_launcher_workspace = /** @type {(inputs: Launcher_WorkspaceInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`Workspace`)
};

const zh_launcher_workspace = /** @type {(inputs: Launcher_WorkspaceInputs) => LocalizedString} */ () => {
	return /** @type {LocalizedString} */ (`工作区`)
};

/**
* | output |
* | --- |
* | "Workspace" |
*
* @param {Launcher_WorkspaceInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_workspace = /** @type {((inputs?: Launcher_WorkspaceInputs, options?: { locale?: "en" | "zh" }) => LocalizedString) & import('../runtime.js').MessageMetadata<Launcher_WorkspaceInputs, { locale?: "en" | "zh" }, {}>} */ ((inputs = {}, options = {}) => {
	const locale = experimentalStaticLocale ?? options.locale ?? getLocale()
	if (locale === "zh") return zh_launcher_workspace(inputs)
	return en_launcher_workspace(inputs)
});