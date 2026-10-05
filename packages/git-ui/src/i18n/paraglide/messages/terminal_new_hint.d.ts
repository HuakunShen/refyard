/**
* | output |
* | --- |
* | "Press + to open a terminal in this repository." |
*
* @param {Terminal_New_HintInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const terminal_new_hint: ((inputs?: Terminal_New_HintInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Terminal_New_HintInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Terminal_New_HintInputs = {};
