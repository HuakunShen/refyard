/**
* | output |
* | --- |
* | "Submodules" |
*
* @param {Sidebar_SubmodulesInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sidebar_submodules: ((inputs?: Sidebar_SubmodulesInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Sidebar_SubmodulesInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Sidebar_SubmodulesInputs = {};
