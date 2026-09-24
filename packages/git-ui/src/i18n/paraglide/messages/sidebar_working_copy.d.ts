/**
* | output |
* | --- |
* | "Working Copy" |
*
* @param {Sidebar_Working_CopyInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const sidebar_working_copy: ((inputs?: Sidebar_Working_CopyInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Sidebar_Working_CopyInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Sidebar_Working_CopyInputs = {};
