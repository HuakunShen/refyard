/**
* | output |
* | --- |
* | "Close terminal" |
*
* @param {Terminal_Close_TabInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const terminal_close_tab: ((inputs?: Terminal_Close_TabInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Terminal_Close_TabInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Terminal_Close_TabInputs = {};
