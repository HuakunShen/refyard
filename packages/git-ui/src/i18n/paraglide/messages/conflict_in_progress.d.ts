/**
* | output |
* | --- |
* | "{operation} in progress" |
*
* @param {Conflict_In_ProgressInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_in_progress: ((inputs: Conflict_In_ProgressInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conflict_In_ProgressInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conflict_In_ProgressInputs = {
    operation: NonNullable<unknown>;
};
