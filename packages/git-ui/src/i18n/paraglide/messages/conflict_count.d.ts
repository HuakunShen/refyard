/**
* | output |
* | --- |
* | "{n} conflicted path(s)" |
*
* @param {Conflict_CountInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const conflict_count: ((inputs: Conflict_CountInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Conflict_CountInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Conflict_CountInputs = {
    n: NonNullable<unknown>;
};
