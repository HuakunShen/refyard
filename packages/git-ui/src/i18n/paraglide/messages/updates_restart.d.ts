/**
* | output |
* | --- |
* | "Restart to finish" |
*
* @param {Updates_RestartInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const updates_restart: ((inputs?: Updates_RestartInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Updates_RestartInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Updates_RestartInputs = {};
