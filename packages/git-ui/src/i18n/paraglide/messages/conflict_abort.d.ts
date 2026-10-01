/**
* | output |
* | --- |
* | "Abort {operation}" |
*
* @param {Conflict_AbortInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_abort: ((inputs: Conflict_AbortInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conflict_AbortInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conflict_AbortInputs = {
    operation: NonNullable<unknown>;
};
