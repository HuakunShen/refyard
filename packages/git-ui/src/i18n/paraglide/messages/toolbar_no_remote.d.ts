/**
* | output |
* | --- |
* | "No remote is configured for this repository" |
*
* @param {Toolbar_No_RemoteInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const toolbar_no_remote: ((inputs?: Toolbar_No_RemoteInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Toolbar_No_RemoteInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Toolbar_No_RemoteInputs = {};
