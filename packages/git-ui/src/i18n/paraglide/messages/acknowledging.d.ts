/**
* | output |
* | --- |
* | "Acknowledging…" |
*
* @param {AcknowledgingInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const acknowledging: ((inputs?: AcknowledgingInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<AcknowledgingInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type AcknowledgingInputs = {};
