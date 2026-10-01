/**
* | output |
* | --- |
* | "Escape" |
*
* @param {Escape_KeyInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const escape_key: ((inputs?: Escape_KeyInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Escape_KeyInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Escape_KeyInputs = {};
