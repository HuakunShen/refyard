/**
* | output |
* | --- |
* | "no conflicted paths remain" |
*
* @param {Conflict_No_PathsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_no_paths: ((inputs?: Conflict_No_PathsInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conflict_No_PathsInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conflict_No_PathsInputs = {};
