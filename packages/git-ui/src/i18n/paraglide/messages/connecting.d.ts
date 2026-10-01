/**
* | output |
* | --- |
* | "Connecting…" |
*
* @param {ConnectingInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const connecting: ((inputs?: ConnectingInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<ConnectingInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type ConnectingInputs = {};
