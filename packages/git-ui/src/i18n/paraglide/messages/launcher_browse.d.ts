/**
* | output |
* | --- |
* | "Browse" |
*
* @param {Launcher_BrowseInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const launcher_browse: ((inputs?: Launcher_BrowseInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Launcher_BrowseInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Launcher_BrowseInputs = {};
