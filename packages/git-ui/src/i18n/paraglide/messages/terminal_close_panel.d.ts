/**
* | output |
* | --- |
* | "Close terminal panel" |
*
* @param {Terminal_Close_PanelInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const terminal_close_panel: ((inputs?: Terminal_Close_PanelInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Terminal_Close_PanelInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Terminal_Close_PanelInputs = {};
