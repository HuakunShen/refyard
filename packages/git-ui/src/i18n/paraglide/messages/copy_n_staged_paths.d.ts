/**
* | output |
* | --- |
* | "{n} staged path{s}" |
*
* @param {Copy_N_Staged_PathsInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_n_staged_paths: ((inputs: Copy_N_Staged_PathsInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Copy_N_Staged_PathsInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Copy_N_Staged_PathsInputs = {
    n: NonNullable<unknown>;
    s: NonNullable<unknown>;
};
