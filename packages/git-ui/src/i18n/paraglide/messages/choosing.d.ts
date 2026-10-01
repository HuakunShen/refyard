/**
* | output |
* | --- |
* | "Choosing…" |
*
* @param {ChoosingInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const choosing: ((inputs?: ChoosingInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<ChoosingInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type ChoosingInputs = {};
