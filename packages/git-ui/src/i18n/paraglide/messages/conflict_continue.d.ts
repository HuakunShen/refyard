/**
* | output |
* | --- |
* | "Continue {operation}" |
*
* @param {Conflict_ContinueInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_continue: ((inputs: Conflict_ContinueInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conflict_ContinueInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conflict_ContinueInputs = {
    operation: NonNullable<unknown>;
};
