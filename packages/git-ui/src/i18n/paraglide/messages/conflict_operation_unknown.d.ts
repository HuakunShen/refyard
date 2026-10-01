/**
* | output |
* | --- |
* | "unknown operation" |
*
* @param {Conflict_Operation_UnknownInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_operation_unknown: ((inputs?: Conflict_Operation_UnknownInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conflict_Operation_UnknownInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conflict_Operation_UnknownInputs = {};
