/**
* | output |
* | --- |
* | "Workbench" |
*
* @param {Logo_WorkbenchInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const logo_workbench: ((inputs?: Logo_WorkbenchInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Logo_WorkbenchInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Logo_WorkbenchInputs = {};
