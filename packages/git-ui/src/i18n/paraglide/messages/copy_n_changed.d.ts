/**
* | output |
* | --- |
* | "{n} changed" |
*
* @param {Copy_N_ChangedInputs} inputs
* @param {{ locale?: "en" | "zh" }} options
* @returns {LocalizedString}
*/
export const copy_n_changed: ((inputs: Copy_N_ChangedInputs, options?: {
    locale?: "en" | "zh";
}) => LocalizedString) & import("../runtime.js").MessageMetadata<Copy_N_ChangedInputs, {
    locale?: "en" | "zh";
}, {}>;
export type LocalizedString = import("../runtime.js").LocalizedString;
export type Copy_N_ChangedInputs = {
    n: NonNullable<unknown>;
};
